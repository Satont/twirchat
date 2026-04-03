import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  schema: "https://7tv.io/v4/gql",
  documents: "./src/seventv/queries/*.graphql",
  generates: {
    "./src/seventv/gql/": {
      preset: "client",
      plugins: [],
      config: {
        useTypeImports: true,
        skipTypename: true,
      },
    },
  },
};

export default config;
