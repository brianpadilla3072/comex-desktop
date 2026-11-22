import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";

import { subscribeToQueryCacheChanges } from "../src/react-app/infra/query-cache-state";

// Hive QA w1-3: a component mounting created its query during render; the "added" event re-rendered
// SessionRoute mid-render. Creating a query must not notify; changing data must.
test("creating a query does not notify subscribers, changing its data does", () => {
  const client = new QueryClient();
  let calls = 0;
  const stop = subscribeToQueryCacheChanges(client, () => { calls += 1; });
  client.getQueryCache().build(client, { queryKey: ["mounted"] });
  expect(calls).toBe(0);
  client.setQueryData(["mounted"], { ready: true });
  expect(calls).toBeGreaterThan(0);
  const afterData = calls;
  client.removeQueries({ queryKey: ["mounted"] });
  expect(calls).toBeGreaterThan(afterData);
  stop();
});
