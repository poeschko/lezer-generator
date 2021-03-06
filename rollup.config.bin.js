import typescript from "rollup-plugin-typescript2"
import nodeResolve from "rollup-plugin-node-resolve"
import commonjs from "rollup-plugin-commonjs"

export default {
  input: "bin/lezer-generator.ts",
  output: {
    file: "dist/lezer-generator.js",
    format: "cjs",
    paths: {"..": "./index.js"}
  },
  external: ["fs", ".."],
  plugins: [
    nodeResolve(),
    typescript({
      check: false,
      tsconfigOverride: {
        compilerOptions: {
          lib: ["es2018"],
          sourceMap: true,
          target: "es2018",
          strict: false,
          declaration: false
        },
        include: ["bin/*.ts", "src/*.ts"]
      }
    }),
    commonjs()
  ]
}
