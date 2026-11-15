// Connecting accounts to share to, in words any blog can use (docs/studio-words.md). Pure data,
// read with `say()` from words.js.

/** @type {Record<string, { text: string, layer: "her" | "details", max?: number, bare?: string }>} */
export const WORDS = {
  "bluesky.namePlaceholder": { text: "yourname.bsky.social", layer: "her", max: 60 },
  "bluesky.nameError": { text: "Type your Bluesky name, like yourname.bsky.social.", layer: "her" },
  "social.pagesTruncated": { text: "Facebook sent only some of your Pages. If yours isn't here, tell {helper}.", layer: "her" },
  "social.orgsTruncated": { text: "LinkedIn sent only some of your company pages. If yours isn't here, tell {helper}.", layer: "her" },
  "social.facebookNoPage": { text: "Facebook didn't show any Page you can post to. You need to run the Page. If you do, ask {helper} to add you to its Facebook app.", layer: "her" },
  "social.signInAgain": { text: "{service} will ask you to sign in. Use the {service} account you used the first time. If {service} shows someone else's name, tell {helper}.", layer: "her" },
  "social.canTurnOn": { text: "{helper} can turn it on. Your site works the same without it.", layer: "her" },
  "social.noPlaces": { text: "{helper} needs to add Facebook or another place first.", layer: "her" },
  "social.disconnected": { text: "Disconnected {name}.", layer: "her" },
  "social.reconnectTitle": { text: "Reconnect {name}", layer: "her" },
  "social.disconnectAsk": { text: "Disconnect {name}?", layer: "her" },
  "social.reconnected": { text: "Reconnected. {name} works again.", layer: "her" },
  "social.reconnectedIt": { text: "Reconnected. It works again.", layer: "her" },
  "social.already": { text: "{name} is already connected. Use Reconnect on it if it stopped working.", layer: "her" },
  "social.gone": { text: "{name} isn't connected any more. Connect it again.", layer: "her" },
  "social.connected": { text: "Connected. {product} can post to {name} on {service} now.", layer: "her" },
  "social.connectedFacebook": { text: "Connected. {product} can post to {name} on {service} now. To add another Facebook Page, connect Facebook again.", layer: "her", max: 240 },
  "social.connectedIt": { text: "Connected. {product} can post to it on {service} now.", layer: "her" },
};
