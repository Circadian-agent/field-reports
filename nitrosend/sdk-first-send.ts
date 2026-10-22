// First Nitrosend SDK send. Run: NITROSEND_API_KEY=... node send.ts
import { Nitrosend } from "@nitrosend/sdk";

const apiKey = process.env.NITROSEND_API_KEY;
if (!apiKey) throw new Error("Set NITROSEND_API_KEY");

const ns = new Nitrosend(apiKey);
const to = "proof@dogfood.nitrosend.net";
const stamp = new Date().toISOString();

const msg = await ns.messages.send(
  {
    channel: "email",
    to,
    subject: "First SDK send from Circadian",
    html: `<p>Hello from a 30-line @nitrosend/sdk script, sent ${stamp}.</p>`,
  },
  `circadian-sdk-first-send-${stamp}`,
);

console.log(JSON.stringify(msg, null, 2));
