# Valhalla Discussionsへの連絡案（未送信）

投稿先: https://github.com/valhalla/valhalla/discussions/new?category=general

根拠: https://github.com/valhalla/valhalla#demo-server は、利用者向けアプリの公開時にDiscussionsでの連絡と識別ヘッダーを求めています。以下は送信前の原稿です。

## Title

ride-meter: bounded bicycle routing PWA using the FOSSGIS demo server

## Body

Hello Valhalla maintainers,

We are preparing an update to ride-meter, a bicycle route planning PWA:

- Repository: https://github.com/sir-pendragon/ride-meter
- Website: https://sir-pendragon.github.io/ride-meter/route/
- Contact: https://github.com/sir-pendragon
- Routing endpoint: https://valhalla1.openstreetmap.de
- Identification: `X-Client-Id: sir-pendragon.github.io/ride-meter`

Routing starts only after a user explicitly requests a route. We normally make one `/route` request with alternatives. Optional exploration and closure avoidance share a maximum of three additional `/route` requests, with at most two exploration stages and an approximately 20-second exploration budget. We stop additional exploration after a Valhalla response exceeds eight seconds. We do not automatically retry failed requests, including HTTP 429, 503 and 504.

We use `/trace_attributes` to estimate road properties and identify bridges and tunnels; long shapes are split into approximately 60 km chunks. Optional automatic waypoints are checked in one batched `/locate` request per search. There is no background routing, bulk routing job or scheduled diagnostic run. The developer diagnostic is manual, sequential between scenarios, capped at 40 Valhalla requests, and stops on HTTP 429. Our final local diagnostic used 24 Valhalla requests for five scenarios in total.

The UI describes quiet-road and scenery scores as estimates and preserves OpenStreetMap/Valhalla attribution. Routes are chosen from obtained candidates; they are not guaranteed globally optimal. Terrain elevation is from GSI DEM and is not a measurement of the road surface.

We understand that the public demo is subject to fair usage. Please let us know whether this use is appropriate or if further limits or identification changes are needed before releasing this update. Thank you for providing the service.
