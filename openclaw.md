---                                                                               
  AgentPay — Worker API Reference                                                   
                                                                                    
  Base URL: http://localhost:3000                                                   
  Authentication: Every request must include the header:          
  X-Worker-Key: <WORKER_API_KEY>

  ---
  Job lifecycle

  OpenClaw receives jobs from two BullMQ queues. Each job follows this sequence:

  [search-queue job received]
    → search for product
    → POST /v1/agent/quote

  [user approves in Telegram]

  [checkout-queue job received]  ← contains card details
    → GET /v1/agent/card/:intentId  (one-time reveal)
    → complete checkout using card
    → POST /v1/agent/result

  ---
  1. Receive search job

  Queue: search-queue
  Job name: search-intent

  Job payload:
  {
    "intentId": "cmlx...",
    "userId": "cmlx...",
    "query": "Sony WH-1000XM5 headphones",
    "subject": "Buy Sony headphones",
    "maxBudget": 35000,
    "currency": "gbp"
  }

  - maxBudget and price are in the smallest currency unit (pence for GBP, cents for
  USD)
  - subject is an optional short task title; fall back to query if absent

  ---
  2. Post a quote

  After finding a product, post the result back:

  POST /v1/agent/quote

  {
    "intentId": "cmlx...",
    "merchantName": "Amazon UK",
    "merchantUrl": "https://amazon.co.uk/dp/B09XS7JWHH",
    "price": 27999,
    "currency": "gbp"
  }

  Response:
  { "intentId": "cmlx...", "status": "AWAITING_APPROVAL" }

  The intent now waits for user approval via Telegram. Do not proceed until a
  checkout job arrives — that is the signal that the user approved.

  ---
  3. Receive checkout job

  Queue: checkout-queue
  Job name: checkout-intent

  Job payload:
  {
    "intentId": "cmlx...",
    "userId": "cmlx...",
    "merchantName": "Amazon UK",
    "merchantUrl": "https://amazon.co.uk/dp/B09XS7JWHH",
    "price": 27999,
    "currency": "gbp",
    "stripeCardId": "ic_...",
    "last4": "4242"
  }

  ---
  4. Reveal card details (one-time)

  GET /v1/agent/card/:intentId

  Response:
  {
    "intentId": "cmlx...",
    "number": "4242424242424242",
    "cvc": "123",
    "expMonth": 12,
    "expYear": 2026,
    "last4": "4242"
  }

  Critical: This endpoint can only be called once per intent. The card number is not
   stored server-side. Calling it a second time returns 409 Conflict. Retrieve it,
  use it immediately, do not store it.

  ---
  5. Post checkout result

  POST /v1/agent/result

  On success:
  {
    "intentId": "cmlx...",
    "success": true,
    "actualAmount": 27999,
    "receiptUrl": "https://amazon.co.uk/orders/123"
  }

  On failure:
  {
    "intentId": "cmlx...",
    "success": false,
    "errorMessage": "Payment declined at checkout"
  }

  Response:
  { "intentId": "cmlx...", "status": "DONE" }

  After posting the result the card is automatically cancelled server-side. Do not
  attempt further use.

  ---
  Error responses

  ┌────────┬─────────────────────────────────────────────────┐
  │ Status │                     Meaning                     │
  ├────────┼─────────────────────────────────────────────────┤
  │ 400    │ Invalid request body                            │
  ├────────┼─────────────────────────────────────────────────┤
  │ 401    │ Missing or wrong X-Worker-Key                   │
  ├────────┼─────────────────────────────────────────────────┤
  │ 404    │ Intent not found                                │
  ├────────┼─────────────────────────────────────────────────┤
  │ 409    │ Intent in wrong state, or card already revealed │
  ├────────┼─────────────────────────────────────────────────┤
  │ 500    │ Server error — safe to retry the job            │
  └────────┴─────────────────────────────────────────────────┘
