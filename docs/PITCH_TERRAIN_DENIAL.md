# TERRAIN DENIAL
## Making northern terrain a measurable denial capability

**Draft pitch — internal. Not for external release without the checks in the closing note.**

---

## 1. The strategic problem

The 2026 National Defence Strategy keeps the **Strategy of Denial** as the cornerstone of
Defence planning, and is explicitly framed around deterring an adversary's attempt to
**project power against Australia through our northern approaches**. The 2026 Integrated
Investment Program resources that framing heavily: on the order of **$13–16 billion for
northern bases** — hardening and expanding RAAF Darwin, Tindal, Learmonth and Townsville —
and **$14–21 billion for theatre logistics**, fuel resilience and deployable logistics, inside
a program of roughly **$425 billion over the decade**. The NDS positions the northern base
network and the wider estate as *infrastructure of deterrence* in an era of contested
logistics.

Almost all of that denial investment is aimed at the **air and maritime** approach: long-range
strike, integrated air and missile defence, the targeting enterprise. That is the right
priority. But it leaves a gap that nobody is funding and nobody has digitised:

> **Once anything is ashore or inland — a landing party, a raiding element, a UAS launch team,
> a hostile reconnaissance patrol, or simply an unauthorised vehicle on a base approach —
> the denial problem becomes a *land mobility* problem. And Australia has never quantified
> the single largest denial asset it owns: the ground itself.**

Northern Australia is, for much of the year, its own obstacle belt. Savanna that a vehicle
crosses at 40 km/h in October is impassable in February. A creek line that is a highway in the
Dry is a NO-GO in the Wet. Timber spacing decides whether a corridor carries a section on foot
or a mounted troop in column. **That knowledge currently lives in patrol reports, local
experience, and the heads of people who have driven the country — not in a reproducible,
auditable product.** It cannot be queried, briefed, compared between options, or handed to the
next rotation.

That is the gap this capability closes.

---

## 2. What the capability does

For any area in northern Australia, against any specified mover, it answers three questions
in doctrinal terms and in minutes rather than days:

**a. Where can they go, how fast, and in what numbers?**
Area-to-area — not point-to-point, because the real question is never "from this grid
reference" but "from the areas they could be in, to the areas they want". The output is a
**Modified Combined Obstacle Overlay**: GO / SLOW-GO / NO-GO classified for the *specific*
mover, mobility corridors as bands rather than lines, avenues of approach, key terrain, and
**capacity per corridor** — because *trafficable* and *trafficable in numbers* are different
statements. The doctrinal instrument for that distinction already exists: **Vehicle Cone Index
versus Rating Cone Index**. On fine-grained soil at RCI 43, a 105 mm howitzer (VCI₁ 21) crosses
once; at RCI 48 the same ground will not take fifty passes (VCI₅₀ 49). One vehicle yes, the
column no, on the same ground. We compute that distinction rather than asserting it.

**b. Where will they actually go?**
Least-cost corridor bands per mover, weighted for haste *or* for concealment — the second
using cumulative viewshed from your own observation posts, patrol routes and sensors. Run under
several named assumption sets, then show the **consensus corridor**: the ground that is
favourable under *every* assumption. Agreement across assumptions is where investment is safe;
disagreement is where you need eyes rather than concrete. That distinction is the product's
most defensible single output.

**c. What does it cost to deny it — and what does that buy?**
Chokepoints ranked by how much traffic they carry. Barrier locations found by **minimum cut**:
the cheapest set of places that severs the corridor. Then every proposed measure is scored on
**delay imposed per machine-hour and per dollar**, with resources and emplacement time priced
from a production model already validated against published clearing rates. Measures declare
their doctrinal **obstacle effect — disrupt, turn, fix or block** — and the tool enforces the
doctrinal caveat that most software ignores: **obstacle effects come from obstacles *and*
fires.** An unobserved, unanswered barrier is never reported as *block*. At best it is
*disrupt*. That restraint is deliberate, and it is the difference between a planning tool and a
sales demo.

And the inverse of the same engine plans **your own** mobility: how a patrol, a recovery
element or a logistics move gets from A to B through the same country, including where trail
has to be cut — which speaks directly to contested-logistics route planning and to combat
engineer mobility tasks.

---

## 3. Why this is buildable now, and by us

**The hard part is already in production.** This is not a concept. The underlying engine is a
deployed Australian geospatial product used for wildfire mitigation planning: it samples a
~10 m national DEM, resolves vegetation from the national NVIS spine with state-level overlays,
reads trails from vector tiles already on the device, runs a hex-grid least-cost search over a
fused slope-and-fuel cost surface, and prices the result with a per-segment production model
grounded in published clearing rates. It runs offline in the field, on a phone, with no
reception — which is not a nice-to-have north of the 20th parallel.

**The insight that makes the defence application cheap:** a fire break and a counter-mobility
barrier are *the same object* — a line driven across country to sever a plane. One severs the
passage of fire, the other the passage of vehicles. The existing engine already finds and
prices that line. Because the search grid is planar, **a minimum cut is a shortest path in the
dual graph** — so the cheapest barrier is found by the pathfinder that already ships. The
counter-mobility planner is the fire-break calculator with a different resistance layer and an
inverted objective.

**Sovereign, Australian-built, and running on open data.** The demo uses only openly
discoverable sources: the national DEM and NVIS, Digital Earth Australia's fractional cover and
surface-water observation products at 25 m, **NAFI** fire-scar mapping (2000 to present,
purpose-built for northern Australia, validated by aerial and ground transect north of 20°S),
ELVIS lidar where it exists, and TERN's plot network for measured vegetation structure. No
foreign data dependency, no licence that Defence has to negotiate, and a clear upgrade path to
classified or commissioned inputs.

---

## 4. Defensibility — the part that wins the second meeting

Ukraine's land campaign has been, more than anything else, a **counter-mobility** war — and its
clearest lesson for tooling is that confident terrain data that is *wrong* is worse than no
data at all. So the architecture is built around admitting what it doesn't know:

- **Every parameter is sourced, with its published limitation shown.** Foot movement uses the
  Irmischer & Clarke off-path function, measured on a military cohort in wooded terrain, with
  Tobler as cross-check — and unit movement uses doctrinal march rates (4.0 km/h on roads by
  day, 2.4 km/h cross-country, 1.6 km/h cross-country at night), because a unit is not an
  individual. Load-carriage energetics use Pandolf *with its published 12–33% error band
  displayed*, never as an absolute.
- **Vegetation is modelled by mechanism, not by a fudge factor.** The literature is clear that
  wheeled and tracked vehicles are limited by *different* variables: trees large enough to stop
  a wheeled vehicle are usually too closely spaced to pass, so wheeled movement is gap-width
  limited, while tracked movement is override-force limited by stem diameter. Two computations,
  not one blended coefficient.
- **Every cell reports which data tier answered it, its confidence, and its vintage** — from
  coarse national inference up to measured lidar understorey density. A 2013 lidar tile over
  country that burnt in 2024 does not silently outrank current coarse data.
- **Estimates are biased in the direction of the question.** For your own movement, round
  pessimistic — an optimistic error strands your own vehicles. For adversary mobility, round
  optimistic — assume they get through, because the conservative error is the one that leaves an
  approach unwatched. Same data, opposite rounding, chosen by intent.
- **Known blind spots are stated, not buried:** understorey beneath closed canopy is invisible
  to satellite imagery; fences are not mapped anywhere and stop a column about as well as a
  ditch; and obstacle *breach times* have no citable open source, so they are entered as visible
  planning assumptions until one exists.
- **An egress-safety gate is unconditional.** A proposed barrier that would isolate a position
  or block your own force's only route out is refused, not scored.

---

## 5. Who uses it

- **Regional Force Surveillance Group** — NORFORCE, the Pilbara Regiment and 51st Battalion
  FNQR patrol precisely this country, largely as reservists, dismounted and in vehicles, across
  the NT, Kimberley, Pilbara and Cape York. Route planning, patrol timing, seasonal
  trafficability and reporting what the ground actually permits is their daily work, and it is
  currently unsupported by any purpose-built tool.
- **Combat engineers** — 1st Combat Engineer Regiment in the NT and the wider RAE mobility and
  counter-mobility function: obstacle siting, obstacle intent development, and the effort
  estimates that turn an obstacle plan into a task organisation.
- **Northern base force protection and the Defence Estate** — for a fixed site the problem
  becomes tractable and cheap: you are not solving a continent, you are solving the 10–30 km
  of approaches around one base, once. Approach analysis, sensor and observation siting, and
  vehicle-access denial for the very bases the IIP is hardening.
- **Northern training area management and exercise planning** — Bradshaw Field Training Area
  alone exceeds 870,000 hectares and hosts combined Australia–US training. Mobility planning,
  seasonal access, and terrain appreciation products for exercise design.
- **Theatre logistics** — route viability and capacity for sustainment moves, which is exactly
  the "in numbers, over many passes" problem the VCI/RCI framing answers.

---

## 6. The ask

We are not asking for a capability decision. We are asking for the three things that turn a
credible prototype into a validated one:

1. **A nominated area of interest** in the north — ideally one where ground truth exists and
   somebody can tell us when we are wrong.
2. **A doctrine and subject-matter-expert conversation** — an hour with combat engineers and
   with an RFSU patrol commander would materially improve the model, particularly the obstacle
   breach-time values that are currently our weakest link.
3. **A data-sharing pathway** for anything better than open source — existing lidar holdings,
   estate GIS, gate and culvert data, or historical patrol track logs, which would let us
   calibrate against measured reality rather than inference.

Delivery is staged in four passes, each independently demonstrable: mobility and isochrones;
corridors, capacity and the MCOO product; the trafficability data uplift that makes it
defensible; then the counter-mobility planner and imagery analysis.

**The proposition in one line:** northern terrain is the cheapest denial capability Australia
owns, it is currently unquantified, and we can measure it — honestly, offline, on open data,
and in the vocabulary the people who need it already use.

---

### Note before this goes outside the building

Every figure above traces to a public source, but three things must be checked before external
use. **Verify the NDS and IIP wording and dollar figures directly against the published 2026
documents** — the numbers here come from reporting and summaries, and a misquoted strategy line
would cost more credibility than the whole pitch earns. **Confirm the current state of what is
built versus designed** — the fire-mitigation engine described in §3 is real and deployed; the
mobility and counter-mobility mode is designed and staged but **not yet built**, and the pitch
should say so plainly if asked, because being caught overclaiming is the one failure this
audience does not forgive. And **have someone confirm the doctrinal terminology** reads
correctly to a serving audience before it is used in front of one.
