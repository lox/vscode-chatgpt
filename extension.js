const vscode = require('vscode');
const express = require('express');
const cors = require('cors');
const path = require('path');
const morgan = require('morgan');

function activate(context) {
    const app = express();

    const corsOptions = {
        origin: 'https://chat.openai.com',
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['content-type', 'openai-conversation-id', 'openai-ephemeral-user-id']
    };

    app.use(cors(corsOptions));
    app.use(morgan('combined'));

    app.get('/', (req, res) => {
        res.send('Hello World!');
    });

    app.get(['/.well-known/ai-plugin.json', '/openapi.yaml', '/logo.jpg'], (req, res) => {
        const filePath = path.join(context.extensionPath, 'assets', req.path);
        res.sendFile(filePath);
    });

    app.get('/tabs', async (req, res) => {
        try {
            const allTabs = vscode.window.visibleTextEditors.map(editor => ({
                tabName: path.basename(editor.document.fileName),
                languageId: editor.document.languageId,
                isDirty: editor.document.isDirty,
                isUntitled: editor.document.isUntitled,
            }));

            res.json(allTabs);
        } catch (error) {
            console.log('Failed to get tabs: ', error);
            res.status(500).send('Failed to get tabs');
        }
    });

    app.get('/tabs/:tabName', async (req, res) => {
        const editor = vscode.window.visibleTextEditors.find(
            editor => path.basename(editor.document.fileName) === req.params.tabName
        );

        if (editor) {
            res.json({
                tabName: path.basename(editor.document.fileName),
                languageId: editor.document.languageId,
                isDirty: editor.document.isDirty,
                isUntitled: editor.document.isUntitled,
            });
        } else {
            res.status(404).send('No such tab');
        }
    });

    app.get('/tabs/:tabName/text', async (req, res) => {
        const editor = vscode.window.visibleTextEditors.find(
            editor => path.basename(editor.document.fileName) === req.params.tabName
        );

        if (editor) {
            res.send(editor.document.getText());
        } else {
            res.status(404).send('No such tab');
        }
    });

    app.get('/tabs/:tabName/symbols', async (req, res) => {
        const editor = vscode.window.visibleTextEditors.find(
            editor => path.basename(editor.document.fileName) === req.params.tabName
        );

        if (editor) {
            const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', editor.document.uri);
            console.log(symbols);
            res.json(symbols.map(symbol => ({
                name: symbol.name,
                kind: symbol.kind,
                range: symbol.range,
                selectionRange: symbol.selectionRange
            })));
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
