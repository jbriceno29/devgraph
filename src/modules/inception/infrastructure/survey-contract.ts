/** Plan REP, R3: the JSON the survey returns (the service checks every path against `git ls-files`). */
const strings = { type: 'array', items: { type: 'string' } };
const note = {
  type: 'object',
  additionalProperties: false,
  required: ['description', 'evidence'],
  properties: { description: { type: 'string' }, evidence: strings },
};
export const surveySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['modules', 'entryPoints', 'tests', 'pending'],
  properties: {
    modules: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'summary', 'paths', 'capabilities'],
        properties: {
          name: { type: 'string' },
          summary: { type: 'string' },
          paths: strings,
          capabilities: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['title', 'summary', 'status', 'missing', 'evidence'],
              properties: {
                title: { type: 'string' },
                summary: { type: 'string' },
                status: { type: 'string', enum: ['COMPLETE', 'PARTIAL'] },
                missing: { type: 'string' },
                evidence: strings,
              },
            },
          },
        },
      },
    },
    entryPoints: { type: 'array', items: note },
    tests: note,
    pending: { type: 'array', items: note },
  },
};
