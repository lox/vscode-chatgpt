const vscode = require('vscode');
const express = require('express');
const cors = require('cors');
const path = require('path');
const morgan = require('morgan');
const os = require('os');
const fs = require('fs');

function getTabByLabel(label) {
    for (let tabGroup of vscode.window.tabGroups.all) {
        for (let t of tabGroup.tabs) {
            if (t.label === label) {
                return t
            }
        }
    }
}

function getSymbolsRecursively(symbols) {
    // https://github.com/microsoft/vscode/blob/40474d7f457b2821e61c6bad840e4af8ce45415d/src/vs/editor/common/languages.ts#L1097
    const symbolKindNames = {
        0: 'File',
        1: 'Module',
        2: 'Namespace',
        3: 'Package',
        4: 'Class',
        5: 'Method',
        6: 'Property',
        7: 'Field',
        8: 'Constructor',
        9: 'Enum',
        10: 'Interface',
        11: 'Function',
        12: 'Variable',
        13: 'Constant',
        14: 'String',
        15: 'Number',
        16: 'Boolean',
        17: 'Array',
        18: 'Object',
        19: 'Key',
        20: 'Null',
        21: 'EnumMember',
        22: 'Struct',
        23: 'Event',
        24: 'Operator',
        25: 'TypeParameter'
    }

    let allSymbols = [];
    symbols.forEach(symbol => {
        let symbolEntry = {
            name: symbol.name,
            kindName: symbolKindNames[symbol.kind],
            range: symbol.range,
        }
        if (symbol.children) {
            symbolEntry.children = getSymbolsRecursively(symbol.children);
        }
        allSymbols.push(symbolEntry);
    });
    return allSymbols;
}

function rangeToString(range) {
    return `[${range.start.line},${range.start.character}-${range.end.line},${range.end.character}]`;
}

function renderOutline(symbols, indent = '') {
    let outline = '';
    for (const symbol of symbols) {
        outline += `${indent}${symbol.kindName} ${symbol.name} ${rangeToString(symbol.range)}\n`;
        if (symbol.children) {
            outline += renderOutline(symbol.children, indent + '  ');
        }
    }
    return outline;
}

function activate(context) {
    const app = express();

    const corsOptions = {
        origin: 'https://chat.openai.com',
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['content-type', 'openai-conversation-id', 'openai-ephemeral-user-id']
    };

    app.use(cors(corsOptions));
    app.use(morgan('combined'));
    app.use(express.json());
    
    app.get('/', (req, res) => {
        res.send('Hello World!');
    });

    app.get(['/.well-known/ai-plugin.json', '/openapi.yaml', '/logo.jpg'], (req, res) => {
        const filePath = path.join(context.extensionPath, 'assets', req.path);
        res.sendFile(filePath);
    });

    app.get('/tabs', async (req, res) => {
        try {
            let allTabs = [];
            for (let tabGroup of vscode.window.tabGroups.all) {
                for (let tab of tabGroup.tabs) {
                    allTabs.push({
                        tabName: tab.label,
                        path: vscode.workspace.asRelativePath(tab.input.uri.fsPath),
                    });
                }
            }
            res.json(allTabs);
        } catch (error) {
            console.log('Failed to get tabs: ', error);
            res.status(500).send('Failed to get tabs');
        }
    });

    app.get('/tabs/:tabName', async (req, res) => {
        let tab = getTabByLabel(req.params.tabName);
        if (tab) {
            const filePath = tab.input.uri.fsPath;
            fs.readFile(filePath, 'utf8', (err, data) => {
                if (err) {
                    console.error(err);
                    res.status(500).send('Failed to read file');
                } else {
                    res.send(data);
                }
            });
        } else {
            res.status(404).send('No such tab');
        }
    });

    app.get('/tabs/:tabName/symbols', async (req, res) => {
        let tab = getTabByLabel(req.params.tabName);
        if (tab) {
            const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', tab.input.uri);
            const allSymbols = getSymbolsRecursively(symbols);
            res.send(renderOutline(allSymbols));
        } else {
            res.status(404).send('No such tab');
        }
    });

    app.post('/tabs/modify', async (req, res) => {
        let tab = getTabByLabel(req.body.tabName);
        if (tab) {
            const { startLine, startCharacter, endLine, endCharacter, newText } = req.body;

            // Get the text of the document
            const doc = await vscode.workspace.openTextDocument(tab.input.uri);
            let text = doc.getText();

            // Calculate the start and end offsets of the range in the text
            let startOffset = doc.offsetAt(new vscode.Position(startLine, startCharacter));
            let endOffset = doc.offsetAt(new vscode.Position(endLine, endCharacter));

            // Apply the changes to the text
            text = text.substring(0, startOffset) + newText + text.substring(endOffset);

            // Write the modified text to a temporary file
            const tempFilePath = path.join(os.tmpdir(), req.body.tabName);
            fs.writeFileSync(tempFilePath, text);

            // Open a diff view between the original document and the temporary file
            const tempFileUri = vscode.Uri.file(tempFilePath);
            vscode.commands.executeCommand('vscode.diff', tempFileUri, tab.input.uri, 'Proposed Changes');

            res.status(200).send('Diff view opened successfully');
        } else {
            res.status(404).send('No such tab');
        }
    });
    
    const server = app.listen(3000, () => {
        console.log('Server started on port 3000');
    });

    context.subscriptions.push({
        dispose: () => {
            server.close();
        }
    });
}

exports.activate = activate;

function deactivate() {
    console.log('Extension has been deactivated');
}

module.exports = {
    activate,
    deactivate
};
