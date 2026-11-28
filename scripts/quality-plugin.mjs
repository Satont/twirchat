import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspaceRoot = fileURLToPath(new URL('../', import.meta.url))
const workspaceName = /^(?:desktop|backend|shared)$/u
const workspaceImport = /^@twirchat\/(desktop|backend|shared)(?:[/\\]|$)/u
const externalGpuixPackages = new Set([
  '@gpuix/react',
  '@gpuix/native',
  '@gpuix/native-darwin-arm64',
  '@gpuix/native-linux-x64-gnu',
  '@gpuix/native-win32-arm64-msvc',
  '@gpuix/native-win32-x64-msvc',
])

function workspacePackage(filename) {
  const [directory, name] = relative(workspaceRoot, filename).split(sep)
  return directory === 'packages' && workspaceName.test(name ?? '') ? name : undefined
}

function workspaceRelativePath(filename) {
  return relative(workspaceRoot, filename).split(sep).join('/')
}

function workspaceLink(path) {
  if (path.startsWith('../')) return undefined
  return /(?:^|\/)node_modules\/@twirchat\/(desktop|backend|shared)(?:\/|$)/u.exec(path)
}

function desktopImportPath(specifier, filePath, link) {
  return filePath
    ? link?.[1] === 'desktop'
      ? filePath.slice(link.index + link[0].length)
      : filePath.replace(/^packages\/desktop\//u, '')
    : specifier
        .replace(/^@desktop\/+/u, 'src/')
        .replace(/^@gpuix\/+/u, 'src/gpuix/')
        .replace(/^@twirchat\/desktop\/+/u, '')
}

function importSpecifier(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0)
    return node.quasis[0]?.value.cooked ?? undefined
  return undefined
}

function importSource(node) {
  if (node.type === 'CallExpression') return node.arguments[0]
  if (node.type === 'TSImportEqualsDeclaration') {
    if (node.moduleReference.type === 'TSExternalModuleReference')
      return node.moduleReference.expression
    return undefined
  }
  return node.source
}

function importedFile(filename, specifier) {
  const path = specifier.replaceAll('\\', '/')
  if (isAbsolute(path) || /^\.{1,2}(?:\/|$)/u.test(path)) return resolve(dirname(filename), path)
  if (specifier.startsWith('file:')) {
    try {
      return fileURLToPath(specifier)
    } catch {
      return undefined
    }
  }
  return undefined
}

function packageForAlias(specifier) {
  const packageName = workspaceImport.exec(specifier)?.[1]
  if (packageName) return packageName
  if (/^@backend(?:[/\\]|$)/u.test(specifier)) return 'backend'
  if (/^@(?:desktop|views)(?:[/\\]|$)/u.test(specifier)) return 'desktop'
  // The local @gpuix/* alias shares a scope with actual dependencies.
  if (/^@gpuix[/\\]/u.test(specifier)) {
    const dependency = specifier.split(/[/\\]/u, 2).join('/')
    if (!externalGpuixPackages.has(dependency)) return 'desktop'
  }
  return undefined
}

/** @type {Parameters<import('oxlint/plugins-dev').RuleTester['run']>[1]} */
const workspaceImportBoundaries = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      direction: '{{from}} cannot import {{target}}. Put cross-app contracts in @twirchat/shared.',
      sharedEntry: 'Import shared code through @twirchat/shared rather than its filesystem path.',
      aliasPath: 'Use a canonical workspace import without dot segments or backslashes.',
      desktopRuntime:
        'Use the desktop backend bridge instead of importing desktop src/{{area}} from GPUIX.',
      desktopFoundation:
        'Desktop localization and state primitives must not depend on GPUIX or React.',
      localeHook:
        'Use the desktop localization service; React translation hooks belong to GPUIX presentation.',
    },
  },
  create(context) {
    const from = workspacePackage(context.filename)
    if (!from) return {}
    const importer = workspaceRelativePath(context.filename)
    const desktopSource = importer.startsWith('packages/desktop/src/')
    const desktopGpuix = importer.startsWith('packages/desktop/src/gpuix/')
    const isGpuixPresentation =
      desktopGpuix && !importer.startsWith('packages/desktop/src/gpuix/backend/')
    const desktopFoundation = /^packages\/desktop\/src\/(?:i18n|state)\//u.test(importer)

    return {
      'ImportDeclaration, ExportNamedDeclaration[source], ExportAllDeclaration, ImportExpression, TSImportType, TSImportEqualsDeclaration, CallExpression[callee.name="require"]'(
        node,
      ) {
        const source = importSource(node)
        const rawSpecifier = importSpecifier(source)
        if (rawSpecifier === undefined) return
        const specifier = rawSpecifier.split(/[?#]/u, 1)[0]
        const alias = packageForAlias(specifier)
        if (
          (alias || /^@gpuix[/\\]/u.test(specifier)) &&
          /\\|(?:^|\/)\.{1,2}(?:\/|$)/u.test(specifier)
        ) {
          context.report({ node: source, messageId: 'aliasPath' })
          return
        }
        const file = alias ? undefined : importedFile(context.filename, specifier)
        const filePath = file ? workspaceRelativePath(file) : undefined
        const link = filePath ? workspaceLink(filePath) : undefined
        const target = alias ?? link?.[1] ?? (file ? workspacePackage(file) : undefined)
        const desktopPath = target === 'desktop' ? desktopImportPath(specifier, filePath, link) : ''
        if (isGpuixPresentation) {
          const area = /^src\/(store|platforms)(?:\/|$)/u.exec(desktopPath)?.[1]
          if (area) {
            context.report({ node: source, messageId: 'desktopRuntime', data: { area } })
            return
          }
        }
        if (
          desktopFoundation &&
          (/^src\/gpuix(?:\/|$)/u.test(desktopPath) ||
            /^(?:react|react-dom|@gpuix\/[^/]+)(?:\/|$)/u.test(specifier))
        ) {
          context.report({ node: source, messageId: 'desktopFoundation' })
          return
        }
        if (
          desktopSource &&
          !isGpuixPresentation &&
          /^src\/gpuix\/hooks\/use-translation(?:\.[cm]?[jt]sx?)?$/u.test(desktopPath)
        ) {
          context.report({ node: source, messageId: 'localeHook' })
          return
        }
        if (!target || target === from) return
        if (target !== 'shared') {
          context.report({ node: source, messageId: 'direction', data: { from, target } })
        } else if (file) {
          context.report({ node: source, messageId: 'sharedEntry' })
        }
      },
    }
  },
}

/** @type {Parameters<import('oxlint/plugins-dev').RuleTester['run']>[1]} */
const noTypeAssertions = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      assertion: 'Validate external data and narrow its type instead of using a type assertion.',
    },
  },
  create(context) {
    return {
      TSAsExpression(node) {
        context.report({ node, messageId: 'assertion' })
      },
      TSTypeAssertion(node) {
        context.report({ node, messageId: 'assertion' })
      },
    }
  },
}

/** @type {Parameters<import('oxlint/plugins-dev').RuleTester['run']>[1]} */
const noLocalTypeDeclarations = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { localType: 'Declare named interfaces and type aliases at module scope.' },
  },
  create(context) {
    return {
      'TSInterfaceDeclaration, TSTypeAliasDeclaration'(node) {
        if (
          context.sourceCode
            .getAncestors(node)
            .some(
              (ancestor) =>
                'type' in ancestor &&
                (ancestor.type === 'FunctionDeclaration' ||
                  ancestor.type === 'FunctionExpression' ||
                  ancestor.type === 'ArrowFunctionExpression'),
            )
        )
          context.report({ node, messageId: 'localType' })
      },
    }
  },
}

/** @type {Parameters<import('oxlint/plugins-dev').RuleTester['run']>[1]} */
const noBlockingNativeGeometry = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      blockingGeometry:
        'Use getPaintedElementBounds in the UI. getElementBounds blocks until a native UI frame.',
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        const property = node.property
        const name =
          !node.computed && property.type === 'Identifier'
            ? property.name
            : node.computed && property.type === 'Literal'
              ? property.value
              : undefined
        if (name === 'getElementBounds') context.report({ node, messageId: 'blockingGeometry' })
      },
    }
  },
}

// GPUIX wires only these events on <anchored> (custom_elements/anchored.rs) and drops the rest.
const anchoredEvents = new Set(['onClick', 'onMouseEnter', 'onMouseLeave', 'onFileDrop'])

/** @type {Parameters<import('oxlint/plugins-dev').RuleTester['run']>[1]} */
const noUnsupportedAnchoredEvents = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      unsupportedEvent:
        '<anchored> ignores {{name}}. Put the handler on the content element inside it.',
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'anchored') return
        for (const attribute of node.attributes) {
          if (attribute.type !== 'JSXAttribute' || attribute.name.type !== 'JSXIdentifier') continue
          const name = attribute.name.name
          if (/^on[A-Z]/.test(name) && !anchoredEvents.has(name))
            context.report({ node: attribute, messageId: 'unsupportedEvent', data: { name } })
        }
      },
    }
  },
}

export default {
  meta: { name: 'project-quality' },
  rules: {
    'workspace-import-boundaries': workspaceImportBoundaries,
    'no-type-assertions': noTypeAssertions,
    'no-local-type-declarations': noLocalTypeDeclarations,
    'no-blocking-native-geometry': noBlockingNativeGeometry,
    'no-unsupported-anchored-events': noUnsupportedAnchoredEvents,
  },
}
