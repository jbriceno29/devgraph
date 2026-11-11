import { configure } from '@testing-library/react';

// Under a full parallel run the first render of a file pays the cold start of jsdom and React, and the default
// 1 s wait of the async queries (findBy and waitFor) was right at the limit: intermittent failures at ~1.2 s.
// Failing tests still fail; this only gives asynchronous queries room to see what the UI does.
configure({ asyncUtilTimeout: 5000 });
