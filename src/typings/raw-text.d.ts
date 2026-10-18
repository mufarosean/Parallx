// `import text from './file.md?raw'`: the file's text (scripts/build.mjs rawTextPlugin; vitest natively).
declare module '*?raw' {
  const text: string;
  export default text;
}
