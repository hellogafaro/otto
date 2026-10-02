# Final backend acceptance

**PASS for the provider-independent backend phase.** Root inspected and consolidated four independent reviews of the same frozen source; no required finding remains. This records acceptance of Otto's server decisions with controlled integration peers. Real compute/native login/billing/isolation, live provider authorization and Garage durability remain deferred or unverified.

Reviewed baseline: 306bd2d4cbdda76c5d91f5d50763390865fe33ce. Source manifest: [domain-cleanup-source.json](domain-cleanup-source.json), SHA256 984c1aa71e735e7ce99db73ec23b85a44052684213c1125fabe9f16448ea2a1d. Archive SHA256: bf410afdab03bee231dab44f1be76c1a067221d0dc2da4f7adb166d40c763547. All 228 source fingerprints match; 50 historical evidence/UI files are unchanged. Closure records add no implementation changes.

| Independent review | Observed verification | Exact report SHA256 |
| --- | --- | --- |
| [Primary backend review](/home/g4f4r0/.bb/thread-storage/thr_wf6qbwqsku/domain-review/report.md) | 227/227 tests, current static/build checks, 13 grouped production probes and schema incompatibility/preservation probe; PASS | 1aa7d7c4690a9e33c3f451277e5877913dcbaa24f1fd8bcb01bff61ad2c60c07 |
| [Content review](/home/g4f4r0/.bb/thread-storage/thr_bxqf8a5ap9/content-review.md) | Six grouped HTTP/private-PostgreSQL probes, including immutable accepted files, Project/source revocation and selected public sharing; scoped PASS | 9e7cbb0968bc5c246e468e1ad3373d8c8838708b81a321437ca0e7017dbe13c9 |
| [Account/relation review](/home/g4f4r0/.bb/thread-storage/thr_rwa462p5bp/review/report.md) | 18 focused regressions and two independent account/skill/Session probes; scoped PASS | 2fadce460b2813723215411b74e425129ad7984c79e2f878d8331e4e81bd2ede |
| [Schema review](/home/g4f4r0/.bb/thread-storage/thr_md86nz3dud/foundation-review.md) | Native fresh/repeat schema, read cursor/FK violations, read-only startup refusal and declared dependency checks; scoped PASS | 42b8454b2de81967747e4af78a409a8a08418c7912414777e4467b5e7b038af4 |

The primary [standalone verdict](domain-cleanup-verdict.txt) is copied byte-for-byte. Its supplementary-consolidation note is resolved by the three scoped PASS reports above. [Primary observations](domain-cleanup-probes.json) are also copied exactly; raw executable probes and logs remain with the immutable reports.

| Real production input | Independently observed result |
| --- | --- |
| Noncreator manages a Conversation; explicit viewer steers/stops | 403 and no denied-write cursor change; eligible contributors retain discussion and active controls after archive |
| Concurrent skill replacement or equivalent UUID duplicate | One 200/409 winner with one cursor increment; duplicate400 with rollback; workspace-safe relation violations reject |
| Disable during native inspection; foreign creator binds enabled Subscription | 403; only explicit creator reauth plus matching trusted report qualifies |
| Edit Artifact metadata, retry original upload, revoke while bytes are pending | Same immutable ID/request/key/hash/size; post-I/O403 with no delivered bytes |
| Change share preview/source, publish selected text, then revoke | Frozen selected bytes survive source edits; revoke clears snapshot and returns404 |
| Repeat native schema push or present incompatible populated schema | Data and pending queue work preserved; incompatible push/startup rejects without automatic repair |

Private disposable PostgreSQL used 0700 Unix sockets with TCP disabled; HTTP fixtures used port0. Review source hashes and owned-process cleanup were verified. Repeat Drizzle composite-FK DDL is semantic stability, not a no-op. Populated pre-MVP schema changes still require an explicit operator-reviewed data transfer; no automatic live migration was certified. Actual human work time is unknown.
