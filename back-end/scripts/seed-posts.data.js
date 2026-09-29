"use strict";

/**
 * The ten articles the feed is seeded with.
 *
 * Kept apart from the script that writes them so the copy can be edited
 * without touching the database code, and so a test can import the same list
 * it is asserting against.
 *
 * `palette` is the pair of colours the cover image is generated from: the
 * seeder draws an SVG rather than downloading a photograph, which keeps the
 * whole thing working with no network and no licensing question.
 */
const POSTS = [
  {
    slug: "why-your-isp-can-see-more-than-you-think",
    title: "Why your ISP can see more than you think",
    excerpt:
      "Encrypted sites hide the page, not the visit. Here is what still leaks, and what actually closes the gap.",
    tags: ["privacy", "basics"],
    readingMinutes: 6,
    palette: ["#0f172a", "#3b82f6"],
    content: `HTTPS is often described as making your browsing private. It does not. It makes the contents of a page private, which is a different and much narrower claim.

When you load a site, your device first asks a name server where to find it. That question is usually sent in the clear, so anyone carrying your traffic learns the domain before a single encrypted byte moves. The connection that follows also carries the destination address, and on many connections the server name travels unencrypted in the handshake.

What that adds up to is a log of every site you visited, when, and for how long. Not the articles you read, but the fact that you read them. For most purposes that is the sensitive part.

A tunnel changes the shape of the problem. Your provider sees one encrypted connection to one address, and nothing about what travels inside it. The name lookups happen at the far end, past the point where your provider can watch.

This is not a magic trick and it is worth being precise about what moves rather than disappears. Trust shifts from a company you did not choose to one you did. That is only an improvement if the one you chose keeps no logs, which is a promise worth checking rather than assuming.`,
  },
  {
    slug: "aes-256-in-plain-language",
    title: "AES-256 in plain language",
    excerpt:
      "The cipher behind almost everything, explained without a single equation.",
    tags: ["encryption", "basics"],
    readingMinutes: 7,
    palette: ["#134e4a", "#10b981"],
    content: `AES is a way of scrambling data so that it can only be unscrambled by someone holding the right key. The 256 is the length of that key in bits.

Think of the key as a very long combination. A 256-bit key has more possible values than there are atoms in the observable universe, by a wide margin. Trying them one at a time is not slow, it is arithmetically impossible: there is not enough energy in the sun to count that high, let alone test each one.

That is why nobody attacks AES by guessing the key. Attacks go around it. They target the software holding the key, the person who typed it, or the moment before the data was encrypted at all.

This matters for how you judge a claim of security. "AES-256" tells you the cipher is not the weak point. It says nothing about how the key was generated, where it is stored, or who else has a copy. Those are the questions worth asking, and they are the ones the number on the marketing page never answers.`,
  },
  {
    slug: "what-a-zero-log-policy-should-mean",
    title: "What a zero-log policy should mean",
    excerpt:
      "Every provider claims it. Here is how to tell the difference between a promise and an architecture.",
    tags: ["privacy", "trust"],
    readingMinutes: 5,
    palette: ["#3f1d38", "#a855f7"],
    content: `Every provider says they keep no logs. The phrase has been used so widely and so loosely that it now carries almost no information.

Start by separating two things. Connection logs record that an account connected, from where, and for how long. Activity logs record what was done during that connection. A provider can truthfully say they keep no activity logs while retaining connection records that identify you precisely.

Then ask what the service would be able to hand over if compelled. This is the useful question, because it is about capability rather than intention. A provider that cannot produce a record has made a stronger commitment than one that has simply decided not to look.

The strongest signal is architectural. Servers that hold nothing on disk cannot be seized for their contents. Systems that never write an identifier alongside a session cannot correlate one with the other later. These are design decisions, and they are visible in an audit in a way that a policy document is not.

Read the policy, certainly. Then ask what would happen if someone came asking.`,
  },
  {
    slug: "choosing-a-server-that-is-actually-fast",
    title: "Choosing a server that is actually fast",
    excerpt:
      "The nearest one is often the wrong one. What really decides your speed.",
    tags: ["performance", "guides"],
    readingMinutes: 6,
    palette: ["#422006", "#f59e0b"],
    content: `The usual advice is to pick the closest server. Distance does set a floor on latency, and no configuration beats physics. But it is only one of several things deciding what you actually get.

Load matters more than most people expect. A server two thousand kilometres away with room to breathe will regularly outperform a nearer one carrying too many sessions. The nearest option is the most popular option, which is exactly what makes it crowded.

Routing matters too, and it is invisible from your end. Traffic between two nearby cities sometimes travels through a third country because that is where the cheapest transit sits. The path is not the map.

The practical approach is to test rather than reason. Try three servers, keep the one that feels best, and re-test occasionally, because none of these conditions hold still. Time of day changes load. Peering agreements change routes.

If everything feels slow regardless of choice, the bottleneck is probably not the server. Check whether your own connection is being shaped, and whether the protocol in use is one your network treats kindly.`,
  },
  {
    slug: "public-wifi-what-is-the-real-risk",
    title: "Public Wi-Fi: what is the real risk?",
    excerpt:
      "The threat has changed since the advice was written. Some of it is outdated, some is worse than you were told.",
    tags: ["security", "basics"],
    readingMinutes: 6,
    palette: ["#1e1b4b", "#6366f1"],
    content: `The classic warning about coffee shop Wi-Fi came from an era when most of the web was unencrypted. Someone on the same network could read your session outright. That specific attack has largely closed, because almost everything now uses HTTPS by default.

What remains is quieter. The network still sees which sites you connect to, and that pattern is revealing on its own. A network that wants to be hostile can also refuse to let you reach certain places, or answer name lookups with addresses of its choosing.

There is also the question of what "the network" means. A name in a list is not proof of anything. Anyone can broadcast a name, and devices that remember a network will rejoin something wearing the same name without asking.

The defence is the same in each case: do not rely on the local network being honest. A tunnel established before anything else means the network carries traffic it cannot read, cannot redirect, and cannot selectively block.

Turn off automatic reconnection while you are at it. It is the setting that decides whether your device makes this choice, or you do.`,
  },
  {
    slug: "protocols-compared-wireguard-openvpn-ikev2",
    title: "Protocols compared: WireGuard, OpenVPN, IKEv2",
    excerpt:
      "Three ways to build the same tunnel, and the trade-offs that actually show up in daily use.",
    tags: ["protocols", "performance"],
    readingMinutes: 8,
    palette: ["#0c4a6e", "#0ea5e9"],
    content: `OpenVPN has been the default for years. It is thoroughly reviewed, it runs almost everywhere, and it can be made to look like ordinary web traffic, which matters on networks that block anything they recognise. It is also comparatively heavy, and it shows on modest hardware and on battery.

WireGuard is far smaller. The codebase is a fraction of the size, which makes it easier to audit and harder to get wrong, and it is noticeably faster in most conditions. Its design assigns each client an address inside the tunnel, which providers have to work around to avoid it becoming a persistent identifier. Ask how yours does that.

IKEv2 is the quiet third option and it is very good at one thing: surviving a change of network. Moving from Wi-Fi to mobile data breaks most tunnels; IKEv2 usually reconnects before you notice. On a phone that is worth more than a benchmark.

There is no single answer. Use WireGuard when you want speed, IKEv2 when you are moving, and OpenVPN when the network is being difficult. A client worth using makes switching a single tap rather than a reconfiguration.`,
  },
  {
    slug: "dns-leaks-and-how-to-spot-one",
    title: "DNS leaks, and how to spot one",
    excerpt:
      "Your tunnel can be working perfectly while your name lookups go somewhere else entirely.",
    tags: ["privacy", "troubleshooting"],
    readingMinutes: 5,
    palette: ["#450a0a", "#ef4444"],
    content: `A tunnel can be up, encrypted, and carrying your traffic correctly while quietly failing at one job: keeping your name lookups inside it.

The failure is easy to miss because nothing breaks. Pages load. The connection indicator is green. But every domain you visit is still being asked of a server chosen by your provider, and that list is the record you were trying to avoid creating.

It happens for ordinary reasons. Operating systems keep their own resolver settings and do not always defer to the tunnel. Some send lookups to every configured resolver at once and use whichever answers first. Corporate configuration and browser-level resolution add their own paths.

Testing takes a minute. Several sites will show you which resolvers answered on your behalf; if you see your own provider listed while connected, lookups are escaping.

The fix belongs in the client rather than in your own settings. A client that pins the resolver to the tunnel, and that blocks traffic entirely if the tunnel drops, closes this by construction rather than by configuration you have to remember.`,
  },
  {
    slug: "streaming-and-why-it-sometimes-breaks",
    title: "Streaming, and why it sometimes breaks",
    excerpt:
      "A tunnel is not a magic key to a catalogue. Here is what is really happening.",
    tags: ["streaming", "guides"],
    readingMinutes: 6,
    palette: ["#4a044e", "#d946ef"],
    content: `Streaming services license content by region, and they are contractually obliged to enforce it. That enforcement is why the same account shows a different catalogue depending on where it connects from.

Detection is not sophisticated in principle. Addresses belonging to hosting providers are easy to identify and easy to block in bulk, and a very large number of sessions arriving from a single address is an obvious signal. Neither requires knowing anything about you.

This makes it an ongoing back and forth rather than a solved problem. Addresses get flagged, providers rotate them, and a server that worked last week may not work today. Any provider claiming permanent, guaranteed access to a particular service is describing something they cannot control.

If a service stops working, changing servers within the same country is usually enough. Clearing cookies helps too, because a stored regional preference will happily override where you appear to be connecting from.

And it is worth being honest that this is a licensing dispute, not a security feature. It is a real use, but it is not the reason encryption matters.`,
  },
  {
    slug: "the-kill-switch-is-not-optional",
    title: "The kill switch is not optional",
    excerpt:
      "Tunnels drop. What your device does in the seconds that follow is the whole question.",
    tags: ["security", "guides"],
    readingMinutes: 4,
    palette: ["#431407", "#fb923c"],
    content: `Tunnels drop. Networks change, servers restart, a laptop wakes from sleep faster than its connection re-establishes. This is normal and unavoidable.

What is not inevitable is what happens next. By default, an operating system that loses the tunnel simply falls back to the ordinary connection and keeps going. Your traffic continues, unprotected, and nothing on screen suggests anything changed.

A kill switch removes that fallback. If the tunnel is not up, traffic does not move. The failure becomes visible instead of silent, which is the entire point: a connection that fails loudly can be fixed, while one that fails quietly cannot.

The trade-off is real. Sometimes your connection stops working and the reason is the protection rather than the problem. That is the correct behaviour, and it is worth accepting.

Check that yours is on. It is frequently shipped disabled, on the reasonable-sounding grounds that people find sudden loss of connectivity confusing. The alternative is worse.`,
  },
  {
    slug: "what-we-log-and-why-it-is-almost-nothing",
    title: "What we log, and why it is almost nothing",
    excerpt:
      "An honest accounting of every record Shah Kelid keeps, and the reasoning behind each one.",
    tags: ["trust", "privacy"],
    readingMinutes: 5,
    palette: ["#052e16", "#22c55e"],
    content: `It is easy to say "no logs" and harder to say exactly what that means, so here is the full list.

We store your account: an email address, a username, and a hashed password. The hash is one-way, which means we cannot read your password and could not produce it if asked. We keep your billing records, because tax law requires it and because you should be able to see what you paid for.

We do not store which servers you connect to, when you connect, how long you stay, how much data you move, or what addresses you reach. These are not withheld on request. They are not written down at all, which is a stronger position than a policy, because a record that does not exist cannot be produced under any pressure.

Our servers keep nothing on disk that would survive being switched off. Diagnostics are aggregate: total load on a machine, not sessions on a machine.

The reason to prefer this arrangement is not that we are trustworthy. It is that it does not require you to decide whether we are.`,
  },
];

module.exports = { POSTS };
