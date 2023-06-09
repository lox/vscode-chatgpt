const vscode = require('vscode')
const express = require('express')
const cors = require('cors')
const path = require('path')
const morgan = require('morgan')
const os = require('os')
const fs = require('fs')

let server
let serverStatus
let outputChannel

function getTabByLabel (label) {
  for (const tabGroup of vscode.window.tabGroups.all) {
    for (const t of tabGroup.tabs) {
      if (t.label === label) {
        return t
      }
    }
  }
}

function getSymbolsRecursively (symbols) {
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

  const allSymbols = []
  symbols.forEach(symbol => {
    const symbolEntry = {
      name: symbol.name,
      kindName: symbolKindNames[symbol.kind],
      range: symbol.range,
      children: [] // Initialize children property as an empty array
    }

    if (symbol.children) {
      symbolEntry.children = getSymbolsRecursively(symbol.children) // Assign the children symbols recursively
    }

    allSymbols.push(symbolEntry)
  })
  return allSymbols
}

function rangeToString (range) {
  return `[${range.start.line},${range.start.character}-${range.end.line},${range.end.character}]`
}

function renderOutline (symbols, indent = '') {
  let outline = ''
  for (const symbol of symbols) {
    outline += `${indent}${symbol.kindName} ${symbol.name} ${rangeToString(symbol.range)}\n`
    if (symbol.children) {
      outline += renderOutline(symbol.children, indent + '  ')
    }
  }
  return outline
}

function activate (context) {
  const app = express()

  const corsOptions = {
    origin: 'https://chat.openai.com',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['content-type', 'openai-conversation-id', 'openai-ephemeral-user-id']
  }

  // Create a morgan middleware that logs to the outputChannel
  const morganMiddleware = morgan('combined', {
    stream: {
      write: (message) => {
        outputChannel.appendLine(message.trim())
      }
    }
  })

  app.use(morganMiddleware)
  app.use(express.json())
  app.use(cors(corsOptions))

  app.get('/', (req, res) => {
    res.send('Hello World!')
  })

  app.get(['/.well-known/ai-plugin.json', '/openapi.yaml', '/logo.jpg'], (req, res) => {
    const filePath = path.join(context.extensionPath, 'assets', req.path)
    res.sendFile(filePath)
  })

  app.get('/tabs', async (req, res) => {
    try {
      const allTabs = []
      for (const tabGroup of vscode.window.tabGroups.all) {
        for (const tab of tabGroup.tabs) {
          allTabs.push({
            tabName: tab.label,
            path: vscode.workspace.asRelativePath(tab.input.uri.fsPath)
          })
        }
      }
      res.json(allTabs)
    } catch (error) {
      outputChannel.appendLine(error.toString())
      res.status(500).send('Failed to get tabs')
    }
  })

  app.get('/tabs/:tabName', async (req, res) => {
    const tab = getTabByLabel(req.params.tabName)
    if (tab) {
      const filePath = tab.input.uri.fsPath
      fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
          outputChannel.appendLine(err.toString())
          res.status(500).send('Failed to read file')
        } else {
          res.send(data)
        }
      })
    } else {
      res.status(404).send('No such tab')
    }
  })

  app.get('/tabs/:tabName/symbols', async (req, res) => {
    const tab = getTabByLabel(req.params.tabName)
    if (tab) {
      const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', tab.input.uri)
      const allSymbols = getSymbolsRecursively(symbols)
      res.send(renderOutline(allSymbols))
    } else {
      res.status(404).send('No such tab')
    }
  })

  app.post('/tabs/modify', async (req, res) => {
    const tab = getTabByLabel(req.body.tabName)
    if (tab) {
      const { startLine, startCharacter, endLine, endCharacter, newText } = req.body

      // Get the text of the document
      const doc = await vscode.workspace.openTextDocument(tab.input.uri)
      let text = doc.getText()

      // Calculate the start and end offsets of the range in the text
      const startOffset = doc.offsetAt(new vscode.Position(startLine, startCharacter))
      const endOffset = doc.offsetAt(new vscode.Position(endLine, endCharacter))

      // Apply the changes to the text
      text = text.substring(0, startOffset) + newText + text.substring(endOffset)

      // Write the modified text to a temporary file
      const tempFilePath = path.join(os.tmpdir(), req.body.tabName)
      fs.writeFileSync(tempFilePath, text)

      // Open a diff view between the original document and the temporary file
      const tempFileUri = vscode.Uri.file(tempFilePath)
      vscode.commands.executeCommand('vscode.diff', tempFileUri, tab.input.uri, 'Proposed Changes')

      res.status(200).send('Diff view opened successfully')
    } else {
      res.status(404).send('No such tab')
    }
  })

  outputChannel = vscode.window.createOutputChannel('ChatGPT Plugin')
  context.subscriptions.push(outputChannel)
  outputChannel.appendLine('ChatGPT Plugin extension activated')

  serverStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  serverStatus.text = 'Server: stopped'
  serverStatus.show()
  context.subscriptions.push(serverStatus)

  context.subscriptions.push(vscode.commands.registerCommand('extension.startServer', () => {
    try {
      if (!server) {
        server = app.listen(3000, () => {
          outputChannel.appendLine('Server started on port 3000')
          serverStatus.text = 'Server: running'
        })
      } else {
        outputChannel.appendLine('Server is already running')
      }
    } catch (err) {
      outputChannel.appendLine('Failed to start server:' + err.toString())
    }
  }))

  context.subscriptions.push(vscode.commands.registerCommand('extension.stopServer', () => {
    if (server) {
      server.close(() => {
        outputChannel.appendLine('Server stopped')
        serverStatus.text = 'Server: stopped'
      })
      server = null
    } else {
      outputChannel.appendLine('Server is not running')
    }
  }))

  context.subscriptions.push({
    dispose: () => {
      if (server) {
        server.close()
      }
    }
  })
}

exports.activate = activate

function deactivate () {
  if (server) {
    server.close()
  }
  outputChannel.appendLine('ChatGPT extension deactivated')
}

module.exports = {
  activate,
  deactivate
}
