// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import 'reflect-metadata';
import { ExtensionContext, extensions, Uri } from 'vscode';
import { ThunderComputeServerProvider } from './thunderComputeServerProvider';
import { Jupyter } from '../api';

const JUPYTER_EXTENSION_ID = 'ms-toolsai.jupyter';

export async function activate(context: ExtensionContext) {
    // Get the Jupyter extension
    const extension = extensions.getExtension<Jupyter>(JUPYTER_EXTENSION_ID);
    if (!extension) {
        throw new Error(
            'The Jupyter extension (ms-toolsai.jupyter) is required but not installed. Please install it from the VS Code marketplace.'
        );
    }

    try {
        await extension.activate();
    } catch (error) {
        throw new Error(
            `Failed to activate the Jupyter extension: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
    }

    // Create and register the Thunder Compute server provider
    const serverProvider = new ThunderComputeServerProvider();

    // Create A100 server collection
    serverProvider.setCurrentCollection('thunder-compute-a100');
    const a100Collection = extension.exports.createJupyterServerCollection(
        'thunder-compute-a100',
        'Thunder Compute A100 Server',
        serverProvider
    );

    // Create T4 server collection
    serverProvider.setCurrentCollection('thunder-compute-t4');
    const t4Collection = extension.exports.createJupyterServerCollection(
        'thunder-compute-t4',
        'Thunder Compute T4 Server',
        serverProvider
    );

    // Add documentation
    a100Collection.documentation = Uri.parse('https://docs.thundercompute.com/');
    t4Collection.documentation = Uri.parse('https://docs.thundercompute.com/');

    context.subscriptions.push(a100Collection, t4Collection, serverProvider);
}
