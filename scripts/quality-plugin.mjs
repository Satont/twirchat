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

export default {
  meta: { name: 'project-quality' },
  rules: {
    'no-type-assertions': noTypeAssertions,
    'no-local-type-declarations': noLocalTypeDeclarations,
    'no-blocking-native-geometry': noBlockingNativeGeometry,
  },
}
