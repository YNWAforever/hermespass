# HermesPass

Build a modern, high-trust B2B SaaS Enterprise Dashboard for "HermesPass — The Digital Passport & Compliance Infrastructure for AI Agents (KYA)".

### Brand Identity & Design System

- **Theme**: Dark enterprise cybersecurity aesthetic (Deep slate/navy `#0B0F19`, bordered with subtle cyan/emerald glows `#10B981`, `#06B6D4`, clean typography using Inter/Geist).

- **Style**: Ultra-crisp cards, status pills, cryptographic badges, and live stream log visualization.

- **Component Stack**: Tailwind CSS, Shadcn UI, Lucide Icons, Recharts, Framer Motion.

---

### Key Dashboard Pages & Views

#### 1. Agent Directory & KYA Passport Center (`/agents`)

- **Agent Passport Card**:

  - Visual "Digital Passport" card with glowing status badge (`Active`, `Revoked`, `Under Audit`).

  - Agent Details: Agent Name, ID (`did:web:hermespass.asia:agent:...`), Owner Organization, Risk Level badge (Green: Low/Customer Support, Amber: Medium/Procurement, Red: High/Financial Actions).

  - Cryptographic Verification Pill: "W3C VC Verified" with clickable popup showing raw decoded JSON-LD credential and public key thumbprint.

- **Action Toolbar**: "Issue New Agent Passport" modal (Form: Agent Name, Role, Owner Org, Risk Tier, Tool Scopes, Spend Cap).

#### 2. Live Policy Gateway & Human-in-the-Loop Hub (`/approvals`)

- **Real-Time Stream**: WebSocket-connected list of agent actions.

- **Tri-State Status Badges**: `ALLOW` (Green), `DENY` (Red), `HOLD (Pending Review)` (Amber Pulse).

- **Human Review Drawer**:

  - Shows incoming agent request (e.g., "Customer Support Agent Alpha requested refund of HK$ 820 for Order #9812 - Exceeds HK$ 500 auto-cap").

  - Action buttons: "Approve Action", "Reject Action", "Escalate to Telegram".

#### 3. Payment & Scoped Spend Limits (`/wallets`)

- **Virtual Card Visualizer**: Display scoped virtual cards assigned to each agent with cardholder name as Agent ID.

- **Controls**: Interactive spend cap sliders (Daily / Monthly / Per-Tx limit), MCC categories whitelist selector (e.g., Cloud Services, Travel, Office Supplies).

#### 4. Regulatory Audit Log & Compliance Exporter (`/compliance`)

- **Tamper-Evident Hash Chain Table**: Columns: Block Index, Timestamp, Agent ID, Action Type, Payload Hash, Previous Hash, Signature Valid (Icon), Decision.

- **Compliance Header Bar**:

  - Readiness Badges: "IMDA Agentic AI MGF v1.5 Compliant (Singapore)" & "HKMA GenA.I. Sandbox++ Ready (Hong Kong)".

  - Export Button: "Generate 1-Click Regulatory PDF/CSV Report" triggering instant export workflow.

#### 5. Mock Data & State Management

- Pre-populate realistic mock data for 4 agents (Kinnso Recommendation Agent, Fimmick Merchant Concierge, Adfocate Campaign Optimizer, AutoProcure Bot).

- Include working local state to issue new passports, toggle policy limits, and simulate approval clicks.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/0826accd-3a25-4ae6-a818-117a59386dc2).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
