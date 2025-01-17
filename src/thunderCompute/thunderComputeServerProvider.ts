// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken, EventEmitter, Uri, window, workspace, WorkspaceConfiguration, Disposable } from 'vscode';
import { injectable } from 'inversify';
import { JupyterServer, JupyterServerProvider } from '../api';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import fetch, { Response } from 'node-fetch';

// Use HTTP for localhost, HTTPS for production
const THUNDER_API_ENDPOINT =
    process.env.NODE_ENV === 'production' ? 'https://api.thundercompute.com:8443' : 'http://localhost:8080';

const TOKEN_FILE = '.thunder/token';
const REQUEST_TIMEOUT_MS = 300000; // Increase timeout to 5 minutes to handle slow kernel startups
const GPU_TYPE = {
    id: 'thunder-compute-t4',
    label: 'Thunder Compute (T4) - Cost-effective for inference and development'
};

@injectable()
export class ThunderComputeServerProvider implements JupyterServerProvider {
    private _onDidChangeServers = new EventEmitter<void>();
    public readonly onDidChangeServers = this._onDidChangeServers.event;
    private cachedServers: Map<string, JupyterServer> = new Map();
    private activeServers: Map<string, { baseUrl: string; token: string }> = new Map();
    private connectionPromise: Promise<JupyterServer> | null = null;
    private isConnecting = false;
    private currentCollectionId: string = '';
    private disposables: Disposable[] = [];
    private outputChannel = window.createOutputChannel('Thunder Compute');

    private log(message: string) {
        this.outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
    }

    // Disable custom server input
    public readonly supportsQuickPick = true;

    public handleQuickPick(): never {
        throw new Error('Custom server input is not supported');
    }

    constructor() {
        // Listen for window state changes
        this.disposables.push(
            workspace.onDidCloseTextDocument(async (doc) => {
                if (doc.languageId === 'jupyter' || doc.fileName.endsWith('.ipynb')) {
                    // Check if this was the last notebook
                    const openNotebooks = workspace.textDocuments.filter(
                        (d) => d.languageId === 'jupyter' || d.fileName.endsWith('.ipynb')
                    );
                    if (openNotebooks.length === 0) {
                        await this.cleanupAllSessions();
                    }
                }
            })
        );
    }

    private async cleanupSession(serverId: string, sessionInfo: { baseUrl: string; token: string }) {
        try {
            const authToken = await this.getAuthToken();
            const response = await fetch(`${THUNDER_API_ENDPOINT}/jupyter/end`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${authToken}`
                }
            });

            if (!response.ok) {
                if (response.status === 401) {
                    throw new Error('Unauthorized');
                } else if (response.status === 404) {
                    throw new Error('No active Jupyter session');
                } else {
                    throw new Error('Internal error');
                }
            }

            this.activeServers.delete(serverId);
        } catch (error) {
            console.error('Failed to cleanup Jupyter session:', error);
        }
    }

    private async cleanupAllSessions() {
        const cleanupPromises = Array.from(this.activeServers.entries()).map(([serverId, sessionInfo]) =>
            this.cleanupSession(serverId, sessionInfo)
        );
        await Promise.all(cleanupPromises);
    }

    public dispose() {
        this.cleanupAllSessions().catch(console.error);
        this.disposables.forEach((d) => d.dispose());
    }

    public setCurrentCollection(id: string) {
        this.currentCollectionId = id;
    }

    private async getAuthToken(): Promise<string> {
        const tokenPath = path.join(os.homedir(), TOKEN_FILE);
        try {
            return (await fs.readFile(tokenPath, 'utf8')).trim();
        } catch (err) {
            // Token not found, prompt user to enter it
            const token = await window.showInputBox({
                prompt: 'Please enter your Thunder Compute token',
                placeHolder: 'Get your token from console.thundercompute.com',
                ignoreFocusOut: true,
                password: true
            });

            if (!token) {
                throw new Error('Token is required to connect to Thunder Compute');
            }

            // Save the token for future use
            await fs.mkdir(path.dirname(tokenPath), { recursive: true });
            await fs.writeFile(tokenPath, token, 'utf8');
            return token;
        }
    }

    private async fetchWithTimeout(url: string, options: any): Promise<Response> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
            this.log('Request timed out after ' + REQUEST_TIMEOUT_MS + 'ms');
        }, REQUEST_TIMEOUT_MS);

        try {
            this.log(`Making request to ${url} with method ${options.method}`);
            if (options.body) {
                this.log(`Request body: ${options.body}`);
            }

            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
                // For local development, don't use SSL/TLS
                ...(url.includes('localhost') && {
                    agent: undefined
                })
            });

            this.log(`Response status: ${response.status}`);
            if (!response.ok) {
                const text = await response.text();
                this.log(`Error response body: ${text}`);
            }

            return response;
        } catch (error) {
            this.log(`Fetch error details: ${error instanceof Error ? error.stack || error.message : 'Unknown error'}`);
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    private async createJupyterServer(): Promise<JupyterServer> {
        if (this.isConnecting) {
            throw new Error('Already connecting to Thunder Compute server');
        }

        this.isConnecting = true;
        try {
            this.log('Initiating connection to T4 server...');
            window.setStatusBarMessage('Connecting to Thunder Compute T4...', 3000);

            const token = await this.getAuthToken();
            this.log('Auth token retrieved');

            try {
                this.log('Sending start request to API...');
                const response = await this.fetchWithTimeout(`${THUNDER_API_ENDPOINT}/jupyter/start`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        gpuType: 't4'
                    })
                });

                this.log(`Received response with status ${response.status}`);

                if (!response.ok) {
                    const errorMessages: { [key: number]: string } = {
                        401: 'Unauthorized',
                        402: 'Billing information required',
                        400: 'Missing required field: gpuType',
                        503: 'GPU instance not available',
                        500: 'Internal error'
                    };

                    const errorMessage = errorMessages[response.status] || 'Unknown error occurred';
                    throw new Error(`Failed to connect to Thunder Compute: ${errorMessage}`);
                }

                const data = await response.json();
                this.log(`Full response data: ${JSON.stringify(data, null, 2)}`);

                if (!data.baseUrl && !(data.instance_ip && data.port)) {
                    throw new Error(
                        'Invalid response from Thunder Compute server: missing baseUrl or instance_ip/port'
                    );
                }

                window.setStatusBarMessage('Connected to Thunder Compute T4 server', 3000);

                // Ensure we have a proper URL format with no double slashes
                let baseUrl = data.instance_ip ? `http://${data.instance_ip}:${data.port}` : data.baseUrl;
                // Remove trailing slash if present
                baseUrl = baseUrl.replace(/\/$/, '');

                this.log(`Constructed baseUrl: ${baseUrl}`);

                const server = {
                    id: GPU_TYPE.id,
                    label: GPU_TYPE.label,
                    connectionInformation: {
                        baseUrl: Uri.parse(baseUrl),
                        token: data.token,
                        options: {
                            appendToken: true,
                            // Add WebSocket settings
                            webSocket: {
                                // Disable compression which can cause issues
                                disableCompression: true,
                                // Increase timeout to 3 minutes
                                timeout: 180000
                            }
                        }
                    }
                };

                // Track the active server
                this.activeServers.set(server.id, {
                    baseUrl: baseUrl,
                    token: data.token
                });

                this.log(`Server connection info - baseUrl: ${baseUrl}, token: ${data.token}`);
                this.log('Waiting for Jupyter server to start...');
                await new Promise((resolve) => setTimeout(resolve, 6000)); // Wait 6 seconds for server to start
                this.log('Continuing after wait for server startup');
                return server;
            } catch (error: unknown) {
                if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
                    throw new Error('Connection timed out. Please try again or check your network connection.');
                }
                throw error;
            }
        } catch (error: any) {
            const message = error instanceof Error ? error.message : String(error);
            window.showErrorMessage(`Thunder Compute connection failed: ${message}`);
            throw error;
        } finally {
            this.isConnecting = false;
            this.connectionPromise = null;
        }
    }

    public async provideJupyterServers(_token: CancellationToken): Promise<JupyterServer[]> {
        // Initially return just the server type without making any connection
        return [
            {
                id: GPU_TYPE.id,
                label: GPU_TYPE.label
            }
        ];
    }

    public async resolveJupyterServer(server: JupyterServer, _token: CancellationToken): Promise<JupyterServer> {
        // If we already have connection information, return it
        if (server.connectionInformation) {
            return server;
        }

        // If we have a cached server with the same ID, return it
        const cachedServer = this.cachedServers.get(server.id);
        if (cachedServer?.connectionInformation) {
            return cachedServer;
        }

        // If we're already connecting, return the existing promise
        if (this.connectionPromise) {
            return this.connectionPromise;
        }

        // Start a new connection
        this.connectionPromise = this.createJupyterServer();
        try {
            const connectedServer = await this.connectionPromise;
            this.cachedServers.set(server.id, connectedServer);
            return connectedServer;
        } catch (error) {
            this.connectionPromise = null;
            throw error;
        }
    }
}
