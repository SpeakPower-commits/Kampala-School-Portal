# Vendored libraries

Third-party code the portal loads from its own address. The page's
Content-Security-Policy (`script-src 'self'`) allows no scripts from other sites.
Files here are copied unmodified from the official npm release, so anyone can
check them.

## supabase.js — @supabase/supabase-js 2.118.0

- **Used by:** the online edition only (`auth-online.js`, `sync.js`). It is
  loaded on demand, so the offline edition never downloads it.
- **Source:** `dist/umd/supabase.js` from
  <https://registry.npmjs.org/@supabase/supabase-js/-/supabase-js-2.118.0.tgz>
  (npm integrity `sha512-FxI8UXMVC2UG7IkeiI8fuQZqq2oI3JeSu…`, verified by
  `npm pack` on download). Released 15 October 2026.
- **SHA-256:** `ee3be8de192b97cb1d73d1e95d6b82bb1f6b658c0f97c4ef757fc331996ed3d3`
- **Check:** `npm pack @supabase/supabase-js@2.118.0`, extract it, and compare
  `sha256sum package/dist/umd/supabase.js` with the value above.
- **Updating:** pick a release that has been public for at least two weeks,
  replace the file, and update the version and checksum here.

### Licence (MIT)

Copyright (c) 2020 Supabase

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
