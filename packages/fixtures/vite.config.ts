import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        login: resolve(__dirname, 'login.html'),
        customer: resolve(__dirname, 'customer.html'),
        product: resolve(__dirname, 'product.html'),
        controls: resolve(__dirname, 'controls.html'),
        list: resolve(__dirname, 'list.html'),
        wizard: resolve(__dirname, 'wizard.html'),
        iframe: resolve(__dirname, 'iframe.html'),
        longform: resolve(__dirname, 'longform.html'),
      },
    },
  },
});
