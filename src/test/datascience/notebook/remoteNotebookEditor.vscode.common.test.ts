// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as sinon from 'sinon';
import { commands, CompletionList, Position, Uri, window } from 'vscode';
import { logger } from '../../../platform/logging';
import { IDisposable } from '../../../platform/common/types';
import { captureScreenShot, IExtensionTestApi, initialize, startJupyterServer, waitForCondition } from '../../common';
import { closeActiveWindows } from '../../initialize';
import {
    runAllCellsInActiveNotebook,
    waitForExecutionCompletedSuccessfully,
    waitForKernelToGetAutoSelected,
    saveActiveNotebook,
    runCell,
    deleteAllCellsAndWait,
    insertCodeCell,
    waitForTextOutput,
    closeNotebooksAndCleanUpAfterTests,
    createTemporaryNotebook,
    createEmptyPythonNotebook,
    defaultNotebookTestTimeout
} from './helper';
import { openNotebook } from '../helpers';
import { PYTHON_LANGUAGE } from '../../../platform/common/constants';
import { IS_REMOTE_NATIVE_TEST, JVSC_EXTENSION_ID_FOR_TESTS } from '../../constants';
import { PreferredRemoteKernelIdProvider } from '../../../kernels/jupyter/connection/preferredRemoteKernelIdProvider';
import { IServiceContainer } from '../../../platform/ioc/types';
import { IControllerRegistration } from '../../../notebooks/controllers/types';
import { ControllerDefaultService } from './controllerDefaultService';
import { IJupyterServerUriStorage } from '../../../kernels/jupyter/types';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('Remote Execution @kernelCore', function () {
    this.timeout(120_000);
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let ipynbFile: Uri;
    let serviceContainer: IServiceContainer;
    let controllerRegistration: IControllerRegistration;
    let controllerDefault: ControllerDefaultService;
    let storage: IJupyterServerUriStorage;

    suiteSetup(async function () {
        if (!IS_REMOTE_NATIVE_TEST()) {
            return this.skip();
        }
        this.timeout(120_000);
        api = await initialize();
        await startJupyterServer();
        sinon.restore();
        serviceContainer = api.serviceContainer;
        controllerRegistration = api.serviceContainer.get<IControllerRegistration>(IControllerRegistration);
        controllerDefault = ControllerDefaultService.create(api.serviceContainer);
        storage = api.serviceContainer.get<IJupyterServerUriStorage>(IJupyterServerUriStorage);
    });
    // Use same notebook without starting kernel in every single test (use one for whole suite).
    setup(async function () {
        logger.info(`Start Test ${this.currentTest?.title}`);
        sinon.restore();
        if (!this.currentTest?.title.includes('preferred')) {
            await startJupyterServer();
        }
        // Don't use same file for this test (files get modified in tests and we might save stuff)
        ipynbFile = await createTemporaryNotebook(
            [
                {
                    cell_type: 'code',
                    source: ['a = "Hello World"\n'],
                    outputs: [],
                    execution_count: 0,
                    metadata: {}
                },
                {
                    cell_type: 'code',
                    source: ['print(a)\n'],
                    outputs: [],
                    execution_count: 0,
                    metadata: {}
                }
            ],
            disposables
        );
        logger.info(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        logger.info(`Ended Test ${this.currentTest?.title}`);
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this);
        }
        await closeNotebooksAndCleanUpAfterTests(disposables);
        logger.info(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));
    test('MRU and encrypted storage should be updated with remote Uri info', async function () {
        const { editor } = await openNotebook(ipynbFile);
        await waitForKernelToGetAutoSelected(editor, PYTHON_LANGUAGE);
        await deleteAllCellsAndWait();
        await insertCodeCell('print("123412341234")', { index: 0 });
        const cell = editor.notebook.cellAt(0)!;
        const previousList = storage.all;
        await Promise.all([runAllCellsInActiveNotebook(), waitForExecutionCompletedSuccessfully(cell)]);

        // Wait for MRU to get updated & encrypted storage to get updated.
        let newList = previousList;
        await waitForCondition(
            async () => {
                newList = storage.all;
                assert.notDeepEqual(previousList, newList, 'MRU not updated');
                return true;
            },
            5_000,
            () => `MRU not updated, ${JSON.stringify(previousList)} === ${JSON.stringify(newList)}`
        );
    });
    test('Use same kernel when re-opening notebook', async function () {
        await reopeningNotebookUsesSameRemoteKernel(ipynbFile, serviceContainer);
    });

    test('Can run against a remote kernelspec', async function () {
        await waitForCondition(
            () =>
                controllerRegistration.registered.some((item) => item.connection.kind === 'startUsingRemoteKernelSpec'),
            defaultNotebookTestTimeout,
            'No remote controllers'
        );

        // Don't wait for the kernel since we will select our own
        await createEmptyPythonNotebook(disposables, undefined, true);

        // Find the default remote Python kernel (we know that will have ipykernel, as we've set up CI as such).
        const defaultPythonKernel = await controllerDefault.computeDefaultController(undefined, 'jupyter-notebook');
        assert.ok(defaultPythonKernel, 'No default remote kernel');

        assert.strictEqual(
            defaultPythonKernel?.connection.kind,
            'startUsingRemoteKernelSpec',
            'Not a remote kernelspec'
        );
        await commands.executeCommand('notebook.selectKernel', {
            id: defaultPythonKernel!.controller.id,
            extension: JVSC_EXTENSION_ID_FOR_TESTS
        });

        await insertCodeCell('print("123412341234")', { index: 0 });
        const cell = window.activeNotebookEditor?.notebook.cellAt(0)!;
        await Promise.all([runCell(cell), waitForTextOutput(cell, '123412341234')]);
    });

    test.skip('Remote kernels support completions', async function () {
        const { editor } = await openNotebook(ipynbFile);
        await waitForKernelToGetAutoSelected(editor, PYTHON_LANGUAGE);
        let nbEditor = window.activeNotebookEditor!;
        assert.isOk(nbEditor, 'No active notebook');
        // Cell 1 = `a = "Hello World"`
        // Cell 2 = `print(a)`
        let cell2 = nbEditor.notebook.getCells()![1]!;
        await Promise.all([
            runAllCellsInActiveNotebook(false, editor),
            waitForExecutionCompletedSuccessfully(cell2),
            waitForTextOutput(cell2, 'Hello World', 0, false)
        ]);

        // Insert a cell to get completions
        const cell3 = await insertCodeCell('a.');
        const position = new Position(0, 2);

        await waitForCondition(
            async () => {
                const completions = (await commands.executeCommand(
                    'vscode.executeCompletionItemProvider',
                    cell3.document.uri,
                    position
                )) as CompletionList;
                const items = completions.items.map((item) => item.label);
                return items.length > 0;
            },
            defaultNotebookTestTimeout,
            `Completions never return from cell`,
            100,
            true
        );
    });

    return disposables;
});

export async function runCellAndVerifyUpdateOfPreferredRemoteKernelId(
    ipynbFile: Uri,
    serviceContainer: IServiceContainer
) {
    const remoteKernelIdProvider = serviceContainer.get<PreferredRemoteKernelIdProvider>(
        PreferredRemoteKernelIdProvider
    );

    const { editor } = await openNotebook(ipynbFile);
    await waitForKernelToGetAutoSelected(editor, PYTHON_LANGUAGE);
    let nbEditor = window.activeNotebookEditor!;
    assert.isOk(nbEditor, 'No active notebook');
    // Cell 1 = `a = "Hello World"`
    // Cell 2 = `print(a)`
    let cell2 = nbEditor.notebook.getCells()![1]!;
    await Promise.all([
        runAllCellsInActiveNotebook(),
        waitForExecutionCompletedSuccessfully(cell2),
        waitForTextOutput(cell2, 'Hello World', 0, false)
    ]);

    // Confirm kernel id gets saved for this notebook.
    // This is not necessary, but this guarantees a faster & non-flaky test to ensure we don't close the notebook too early.
    // If we nb it as soon as output appears, its possible the kernel id hasn't been saved yet & we mess that up.
    // Optionally we could wait for 100ms.
    await waitForCondition(
        async () => !!(await remoteKernelIdProvider.getPreferredRemoteKernelId(nbEditor.notebook)),
        5_000,
        'Remote Kernel id not saved'
    );
}

export async function reopeningNotebookUsesSameRemoteKernel(ipynbFile: Uri, serviceContainer: IServiceContainer) {
    await runCellAndVerifyUpdateOfPreferredRemoteKernelId(ipynbFile, serviceContainer);
    let nbEditor = window.activeNotebookEditor!;

    await saveActiveNotebook();
    await closeActiveWindows();

    // Re-open and execute the second cell.
    // It should connect to the same live kernel. Don't force it to pick it.
    // Second cell should display the value of existing variable from previous execution.

    const { editor } = await openNotebook(ipynbFile);
    await waitForKernelToGetAutoSelected(editor, PYTHON_LANGUAGE, 100_000, true);
    nbEditor = window.activeNotebookEditor!;
    assert.isOk(nbEditor, 'No active notebook');

    await commands.executeCommand('notebook.clearAllCellsOutputs');

    // Wait till output is empty for both cells
    await waitForCondition(
        async () => !nbEditor.notebook.getCells().some((cell) => cell.outputs.length > 0),
        5_000,
        'Cell output not cleared'
    );

    // Execute second cell (same kernel so should be able to get results)
    const cell2 = nbEditor.notebook.getCells()![1]!;
    await Promise.all([
        runCell(cell2),
        waitForExecutionCompletedSuccessfully(cell2),
        waitForTextOutput(cell2, 'Hello World', 0, false)
    ]);
}
