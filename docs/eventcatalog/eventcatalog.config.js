/** @type {import('@eventcatalog/core/bin/eventcatalog.config').Config} */
export default {
  title: 'Ticketry Architecture',
  tagline: 'See Ticketry from product intent down to runtime contracts and state.',
  organizationName: 'Ticketry',
  theme: 'default',
  output: 'static',
  trailingSlash: false,
  base: '/',
  port: 3100,
  search: {
    type: 'resource',
  },
  navigation: {
    pages: ['list:top-level-domains', 'list:all'],
  },
  mermaid: {
    enableSupportForElkLayout: true,
    iconPacks: ['logos'],
  },
  visualiser: {
    channels: {
      renderMode: 'flat',
    },
  },
  llmsTxt: {
    enabled: true,
  },
  cId: 'dd15b18f-08af-4e7d-8730-8f3b13e7b173',
};
