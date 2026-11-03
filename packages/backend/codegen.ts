import type { CodegenConfig } from '@graphql-codegen/cli'

const config: CodegenConfig = {
  documents: './src/seventv/queries/*.graphql',
  generates: {
    './src/seventv/gql/graphql.ts': {
      config: {
        skipTypename: true,
        useTypeImports: true,
        enumsAsTypes: true,
        enumType: 'string-literal',
        scalars: { Id: 'string' },
      },
      plugins: ['typescript-operations'],
    },
  },
  schema: './src/seventv/schema.graphql',
}

export default config
