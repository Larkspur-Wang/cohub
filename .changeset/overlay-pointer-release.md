---
"@neta-art/cohub": patch
---

Release overlay rect input regions when the pointer leaves them. Once the host makes a cross-origin overlay frame interactive it swallows pointer events, so the host could not tell that the pointer had left a rect region — a resting overlay kept the whole window unclickable. The SDK now reports the pointer while a rect `inputRegion` is active, and the host releases the region as soon as it is outside. Ownership is frozen while any button is held (including a drag that began on the page underneath), and an overlay that opts out or closes loses interaction immediately.

`requestConfigure` also now treats `geometry` as the complete shape: a present object replaces the current one (`{}` fills the layer), and a geometry with any invalid axis is ignored rather than silently becoming a fill.
