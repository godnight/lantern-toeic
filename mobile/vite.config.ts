import {defineConfig} from 'vite';
import tailwind from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
// Exact JSON leaves keep immutable teaching data below the static-asset cap.
// Retain Rolldown's dependency inclusion and automatic handling of other modules.
const privateDataCodeSplitting = {
  groups: [
    {name: "data-word-audio-bindings-v040", test: /[\\/]content[\\/]word-audio-bindings-v040\.json(?:\?.*)?$/, minSize: 0, minShareCount: 1},
    {name: "data-vocabulary-full4109-private", test: /[\\/]content[\\/]vocabulary-full4109-private\.json(?:\?.*)?$/, minSize: 0, minShareCount: 1},
    {name: "data-natural-audio-catalog-v1", test: /[\\/]content[\\/]natural-audio-catalog-v1\.json(?:\?.*)?$/, minSize: 0, minShareCount: 1},
    {name: "data-natural-audio-manifest", test: /[\\/]content[\\/]natural-audio-manifest\.json(?:\?.*)?$/, minSize: 0, minShareCount: 1},
    {name: "data-natural-audio-admission-v2", test: /[\\/]content[\\/]natural-audio-admission-v2\.json(?:\?.*)?$/, minSize: 0, minShareCount: 1},
    {name: "data-vocabulary-v040-b02-private", test: /[\\/]content[\\/]vocabulary-v040-b02-private\.json(?:\?.*)?$/, minSize: 0, minShareCount: 1},
    {name: "data-merged-memberships", test: /[\\/]content[\\/]wordlists[\\/]merged-memberships\.json(?:\?.*)?$/, minSize: 0, minShareCount: 1}
  ],
};

export default defineConfig({root:fileURLToPath(new URL('.',import.meta.url)),base:'./',publicDir:'../public',plugins:[react()],css:{postcss:{plugins:[tailwind()]}},resolve:{alias:{'@':fileURLToPath(new URL('..',import.meta.url))},dedupe:['react','react-dom']},build:{outDir:'dist',emptyOutDir:true,rolldownOptions:{output:{codeSplitting:privateDataCodeSplitting}}}});
