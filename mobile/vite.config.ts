import {defineConfig} from 'vite';
import tailwind from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
export default defineConfig({root:fileURLToPath(new URL('.',import.meta.url)),base:'./',publicDir:'../public',plugins:[react()],css:{postcss:{plugins:[tailwind()]}},resolve:{alias:{'@':fileURLToPath(new URL('..',import.meta.url))},dedupe:['react','react-dom']},build:{outDir:'dist',emptyOutDir:true}});
