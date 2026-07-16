# Separate Project Tracker Projections from Host Capabilities

LLM Wiki treats GitHub, Gitea, Linear, and Plane as Project Tracker providers
that expose External Projections of a canonical `project/<slug>`. They are not
Host Capability Connectors and they do not become Project, Work Item, Work Run,
or knowledge authority.

Project Tracker configuration therefore owns a separate Settings namespace,
endpoint, provider selection, timeout, and device-local Secret Reference. Host
Capability configuration remains reserved for governed search, describe, plan,
and invoke of executable capability descriptors. A Project Tracker REST or
GraphQL endpoint must never be reused as a Host Capability MCP endpoint, and a
Host grant must never authorize a tracker mutation.

Inbound tracker changes become reviewable candidates. Outbound changes are
planned from reviewed local snapshots, recheck the reviewed head immediately
before apply, and fail closed on drift. Multi-device clients join through the
stable Project ID and shared projection provenance while retaining independent
workspace bindings and credential resolution on each device.

Plane support follows its current official REST contract: configurable Cloud or
self-hosted base URL, `X-API-Key` authentication, and the `/work-items/` resource
rather than the retired `/issues/` resource. The clean-room evidence is the
registered Source Note at
`00-Inbox/Sources/plane/plane-rest-api-official-documentation-0387cb926d12.md`;
LLM Wiki does not copy or vendor Plane implementation code.

Create projection replay uses a shared, non-secret canonical receipt under the
Project Work-OS root. The stable slot is keyed by Project entity and target, while
the receipt binds provider, credential-free binding digests, Settings snapshot,
reviewed-head digest, create-plan digest, and the provider-returned remote ID and
revision. An exact successful replay is served from that receipt without another
POST. Any binding, Settings, reviewed-head, provider, or semantic drift is a
conflict and fails closed.

The receipt closes replay only after a successful response is durably recorded;
it cannot turn a provider without an idempotency key into an exactly-once system.
A request accepted remotely but interrupted before response/finalization remains
an unknown-outcome pending receipt. Automatic repost is prohibited until an
operator reconciles the remote object and canonical origin metadata.
