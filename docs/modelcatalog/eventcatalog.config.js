/** @type {import('../eventcatalog/node_modules/@eventcatalog/core/bin/eventcatalog.config').Config} */
export default {
  title: 'Ticketry Model Atlas',
  tagline: 'The backend data model, frontend projections, and the language that connects them.',
  organizationName: 'Ticketry',
  theme: 'sapphire',
  output: 'static',
  trailingSlash: false,
  base: '/',
  port: 3200,
  search: {
    type: 'resource',
  },
  navigation: {
    pages: [],
    groups: [
      {
        id: 'model-atlas',
        label: 'Model Atlas',
        items: [
          {
            id: 'data-model',
            label: 'Data model',
            icon: 'Database',
            href: '/#data-model',
          },
          {
            id: 'ubiquitous-language',
            label: 'Ubiquitous language',
            icon: 'BookOpen',
            href: '/#ubiquitous-language',
          },
        ],
      },
    ],
  },
  visualiser: {
    enabled: false,
  },
  llmsTxt: {
    enabled: false,
  },
  cId: 'dd15b18f-08af-4e7d-8730-8f3b13e7b173-model-atlas',
};
