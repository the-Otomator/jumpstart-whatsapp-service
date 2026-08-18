// Local builds use explicit development markers. The Docker builder replaces
// this module before TypeScript compilation with immutable git provenance.
export const IMAGE_GIT_SHA = 'development'
export const IMAGE_GIT_BRANCH = 'development'
