"use strict";
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@actions/core");
const github_1 = require("@actions/github");
const child_process_1 = require("child_process");
const commentThatWillIgnoreVerification = `[x] Ignore Proposed API verification`;
function getModifiedPackageJson() {
    try {
        const { stdout, stderr } = (0, child_process_1.spawnSync)('git', [`show`, `HEAD:package.json`]);
        if (stdout?.toString().trim().length > 0) {
            return JSON.parse(stdout.toString().trim());
        }
    }
    catch (ex) {
        return;
    }
}
async function getPackageJsonInMainBranch(tag) {
    // If we can find the latest tag, thats even better.
    const url = `https://raw.githubusercontent.com/microsoft/vscode-jupyter/${tag}/package.json`;
    const response = await fetch(url);
    return await response.json();
}
async function verifyProposedApiUsage() {
    if (github_1.context.payload.pull_request?.body?.includes(commentThatWillIgnoreVerification)) {
        console.info(`Proposed API verification is ignored due to override in PR body.`);
        return;
    }
    const modifiedPackageJson = getModifiedPackageJson();
    if (!modifiedPackageJson) {
        return;
    }
    const currentPackageJson = await getPackageJsonInMainBranch('main');
    const currentApiProposals = new Set(currentPackageJson.enabledApiProposals.sort());
    const modifiedApiProposals = modifiedPackageJson.enabledApiProposals;
    const currentEngineVersion = currentPackageJson.engines.vscode;
    const modifiedEngineVersion = modifiedPackageJson.engines.vscode;
    const newApiProposalsAdded = modifiedPackageJson.enabledApiProposals.filter((api) => !currentApiProposals.has(api));
    if (!newApiProposalsAdded.length) {
        return;
    }
    if (newApiProposalsAdded.length && currentEngineVersion !== modifiedEngineVersion) {
        return;
    }
    (0, core_1.error)(`Solution 1: Update engines.vscode package.json.`);
    (0, core_1.error)(`Solution 2: Add the comment '${commentThatWillIgnoreVerification}' to the PR body & push a new commit.`);
    (0, core_1.setFailed)(`Proposed API added (${newApiProposalsAdded.join(', ')}) without updating the engines.vscode in package.json.`);
}
verifyProposedApiUsage();
//# sourceMappingURL=verifyProposedApiUsage.js.map