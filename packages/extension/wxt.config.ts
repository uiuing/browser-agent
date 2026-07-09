import { defineConfig, type WxtViteConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: 'src',
  vite: (): WxtViteConfig => ({
    // tailwind's vite plugin is typed against a newer Vite copy in the tree; the
    // runtime plugin contract is compatible, so we bridge the type here.
    plugins: [tailwindcss() as unknown as WxtViteConfig['plugins']],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  }),
  zip: {
    name: 'browser-agent',
  },
  manifest: {
    name: 'Browser Agent — The Agent Harness for Your Browser',
    short_name: 'Browser Agent',
    description:
      'Open-source agent harness: bring any model — chat, ask, hand work off, and it proves the work against the page. Local-first.',
    version: '0.0.1',
    permissions: ['storage', 'sidePanel', 'scripting', 'tabs', 'activeTab', 'debugger'],
    optional_permissions: ['history', 'bookmarks', 'downloads'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'Open Browser Agent',
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
    web_accessible_resources: [
      {
        resources: ['onboarding.html'],
        matches: ['<all_urls>'],
      },
    ],
  },
});
