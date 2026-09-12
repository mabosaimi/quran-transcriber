import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    permissions: [
      'tabCapture',
      'offscreen',
      'storage',
      'activeTab',
      'sidePanel',
    ],
    minimum_chrome_version: '116',
    action: {},
  },
});
