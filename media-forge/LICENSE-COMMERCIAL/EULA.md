# media-forge — End User License Agreement (Commercial Self-Host / C1)

**Version 1.0 — 2026-06-02 · Produtora MaxVision**

This End User License Agreement ("Agreement") governs the use of the **media-forge**
self-hosted commercial distribution ("Software") by a licensee ("You") under a
valid commercial license key issued by Produtora MaxVision ("Licensor").

## 1. Grant of License
Subject to a valid, non-revoked license key and payment of applicable fees,
Licensor grants You a non-exclusive, non-transferable, revocable license to
install and run the Software **on infrastructure You control**, for **Your own
internal business operations**, including serving Your own clients' media
production needs.

## 2. Restrictions
You may **NOT**:
(a) resell, sublicense, rent, lease, or offer the Software itself as a hosted
    service, SaaS, or API to third parties (the "non-compete" / anti-resale clause,
    modeled on the n8n Sustainable Use License and Sidekiq Pro);
(b) remove, disable, or circumvent the license validation mechanism;
(c) share, publish, or transfer Your license key or bind it to instances You do
    not control;
(d) use the Software to build a competing media-generation hosted product.

Using the Software internally to produce media **for** Your clients is permitted.
Reselling **access to the running Software** to Your clients is not.

## 3. License Validation
The Software validates Your license key against Licensor's license server at
startup and periodically. Upon **revocation** or **expiry**, the Software's
generation tools return HTTP 403 and cease to operate; liveness endpoints
(`/health`, `/metrics`) remain available. A limited **offline grace period**
applies when the license server is temporarily unreachable.

## 4. AI Provider Keys
In the self-host (C1) model, **You supply Your own** AI provider credentials
(Google, fal.ai, etc.). Licensor does not provide AI compute under this Agreement
and is not responsible for Your provider costs.

## 5. Term & Termination
This Agreement is effective until terminated. Licensor may revoke the license key
upon material breach (including Section 2 violations) or non-payment. Upon
termination You must cease all use of the Software.

## 6. Warranty & Liability
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND. TO THE MAXIMUM
EXTENT PERMITTED BY LAW, LICENSOR SHALL NOT BE LIABLE FOR ANY INDIRECT,
INCIDENTAL, OR CONSEQUENTIAL DAMAGES, INCLUDING AI PROVIDER COSTS INCURRED BY YOU.

## 7. Governing Law
This Agreement is governed by the laws of Brazil (Brasil), without regard to
conflict-of-law provisions.

---
Contact: produtoramaxvision@gmail.com
