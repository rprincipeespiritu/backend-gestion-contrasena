import assert from "node:assert/strict";
import { test } from "node:test";
import { createCheckoutTransaction } from "../src/paddle.js";
import { paddleCheckoutConfig, paddleCheckoutUrl } from "../src/checkout-config.js";

test("CifraLock pins the payment page independently of the account default", async (t) => {
  const keys = ["FRONTEND_URL", "PADDLE_CLIENT_TOKEN", "PADDLE_SANDBOX", "PADDLE_API_KEY", "NODE_ENV", "PADDLE_API_URL"];
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => { for (const key of keys) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; } });
  Object.assign(process.env, { FRONTEND_URL: "https://cifralock.example/", PADDLE_CLIENT_TOKEN: "test_public", PADDLE_SANDBOX: "true", PADDLE_API_KEY: "private-test", NODE_ENV: "production" });
  delete process.env.PADDLE_API_URL;
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    requests++;
    assert.equal(url, "https://sandbox-api.paddle.com/transactions");
    const body = JSON.parse(String(init.body));
    assert.equal(body.checkout.url, "https://cifralock.example/checkout");
    assert.equal(body.customer_id, "ctm_test");
    assert.deepEqual(body.items, [{ price_id: "pri_test", quantity: 1 }]);
    return Response.json({ data: { id: "txn_test", checkout: { url: `${body.checkout.url}?_ptxn=txn_test` } } });
  });
  const result = await createCheckoutTransaction({ priceId: "pri_test", userId: "user", email: "test@example.test", customerId: "ctm_test" });
  assert.equal(new URL(result.checkout!.url!).hostname, "cifralock.example");
  assert.deepEqual(paddleCheckoutConfig(), { environment: "sandbox", clientToken: "test_public" });
  process.env.PADDLE_CLIENT_TOKEN = "live_wrong";
  assert.equal(paddleCheckoutConfig(), null);
  assert.throws(() => createCheckoutTransaction({ priceId: "pri_test", userId: "user", email: "test@example.test" }), /PADDLE_CLIENT_TOKEN/);
  assert.equal(requests, 1);
  delete process.env.FRONTEND_URL;
  assert.throws(paddleCheckoutUrl, /FRONTEND_URL/);
  process.env.FRONTEND_URL = "http://unsafe.example";
  assert.throws(paddleCheckoutUrl, /HTTPS/);
  process.env.NODE_ENV = "development";
  process.env.FRONTEND_URL = "http://localhost:3000";
  assert.equal(paddleCheckoutUrl(), "http://localhost:3000/checkout");
});