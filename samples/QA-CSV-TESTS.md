# QA CSV fixtures

These are synthetic test fixtures, not raw exports from the live Event Tickets Plus or PayPal accounts.

- `qa-event-tickets-plus-export.csv` is shaped for the Event Tickets Plus source profile and contains synthetic attendee ticket IDs in the `SDP-41-XXXXXX` style you described. The app should detect it as Event Tickets Plus; choose **Event Tickets Plus export** in Settings if needed.
- `qa-paypal-export.csv` uses the PayPal Activity-style columns and 17-character alphanumeric placeholder Transaction IDs. The values are fake and are not real payment references.
- Both files include an `A Storytelling Dinner` item. It is tracked separately from conference-pass counts, is inferred as the AAD dinner session, should admit at `aad26-dinner`, and should be denied at conference sessions.
- Other rows cover weekly/daytime passes, a daily ticket, a refunded/reversed payment, and a Soweto tour.

Import the Event Tickets Plus file and the PayPal file in either order to test merging. The fixtures use different synthetic IDs; they do not represent the same purchase across the two systems. Use actual redacted headers from your exports to confirm the live column mapping before deployment.
