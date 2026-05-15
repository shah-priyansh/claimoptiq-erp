# ClaimOptiq — MongoDB to PostgreSQL Migration Design

**Date:** 2026-05-15
**Status:** Approved
**Scope:** Backend only — zero frontend changes

---

## Overview

Migrate ClaimOptiq from MongoDB/Mongoose 9 to PostgreSQL (Neon) using Prisma ORM. All API contracts remain identical. Existing production data is migrated via a one-time script.

**Stack after migration:**
- Database: PostgreSQL on Neon (free tier)
- ORM: Prisma (replaces Mongoose)
- Backend hosting: Render (env var swap only)
- Frontend: Vercel — no changes

---

## 1. Schema — 13 PostgreSQL Tables

All primary keys use `uuid`. MongoDB ObjectIds are mapped to new UUIDs during migration.

### roles
| Column | Type | Notes |
|--------|------|-------|
| id | String (uuid) | PK |
| name | String | unique |
| slug | String | unique, lowercase |
| description | String | default '' |
| is_system | Boolean | default false |
| is_active | Boolean | default true |
| created_at | DateTime | |
| updated_at | DateTime | |

### role_module_permissions
| Column | Type | Notes |
|--------|------|-------|
| id | String (uuid) | PK |
| role_id | String | FK → roles |
| module | String | e.g. 'claims', 'hospitals' |
| view | Boolean | default false |
| create | Boolean | default false |
| edit | Boolean | default false |
| delete | Boolean | default false |
| export | Boolean | default false |

### users
| Column | Type | Notes |
|--------|------|-------|
| id | String (uuid) | PK |
| name | String | |
| email | String | unique, lowercase |
| password | String | bcrypt hash |
| role_id | String | FK → roles |
| hospital_id | String? | FK → hospitals, nullable |
| phone | String | |
| is_active | Boolean | default true |
| created_at | DateTime | |
| updated_at | DateTime | |

### hospitals
| Column | Type | Notes |
|--------|------|-------|
| id | String (uuid) | PK |
| name | String | |
| contact | String | default '' |
| email | String | default '' |
| phone | String | default '' |
| address | String | default '' |
| city | String | default '' |
| state | String | default '' |
| pincode | String | default '' |
| reference_by | String | default '' |
| is_active | Boolean | default true |
| created_at | DateTime | |
| updated_at | DateTime | |

### hospital_billing_services
| Column | Type | Notes |
|--------|------|-------|
| id | String (uuid) | PK |
| hospital_id | String | FK → hospitals |
| service_name | String | |
| billing_type | String | enum: fixed_monthly, per_claim_slab, fixed_onetime |
| fixed_amount | Float | default 0 |
| claim_limit | Int | default 0 |
| over_limit_behavior | String | enum: no_charge, per_claim, stop |
| over_limit_per_claim_amount | Float | default 0 |
| slab_range_start | Float | default 0 |
| slab_range_end | Float | default 50000 |
| slab_base_price | Float | default 2000 |
| slab_increment_range | Float | default 50000 |
| slab_increment_price | Float | default 500 |
| calculation_basis | String | enum: hospital_final_bill, final_approval, none |
| is_active | Boolean | default true |

### hospital_doctors
| Column | Type | Notes |
|--------|------|-------|
| id | String (uuid) | PK |
| hospital_id | String | FK → hospitals |
| name | String | |
| specialization | String | default '' |
| phone | String | default '' |
| email | String | default '' |

### insurance_companies
| Column | Type | Notes |
|--------|------|-------|
| id | String (uuid) | PK |
| name | String | unique |
| is_active | Boolean | default true |
| created_at | DateTime | |
| updated_at | DateTime | |

### tpas
| Column | Type | Notes |
|--------|------|-------|
| id | String (uuid) | PK |
| name | String | unique |
| is_active | Boolean | default true |
| created_at | DateTime | |
| updated_at | DateTime | |

### claim_statuses
| Column | Type | Notes |
|--------|------|-------|
| id | String (uuid) | PK |
| slug | String | unique, lowercase |
| label | String | |
| color | String | default 'gray' |
| order | Int | default 0 |
| is_active | Boolean | default true |
| is_system | Boolean | default false |
| created_at | DateTime | |
| updated_at | DateTime | |

### claim_document_types
| Column | Type | Notes |
|--------|------|-------|
| id | String (uuid) | PK |
| name | String | unique |
| description | String | default '' |
| is_required | Boolean | default false |
| order | Int | default 0 |
| is_active | Boolean | default true |
| is_system | Boolean | default false |
| created_at | DateTime | |
| updated_at | DateTime | |

### claims
| Column | Type | Notes |
|--------|------|-------|
| id | String (uuid) | PK |
| sr_no | Int | autoincrement sequence |
| month_claim_no | Int | computed in app before insert |
| claim_generate_date | DateTime | default now() |
| status | String | default 'admitted' |
| hospital_id | String | FK → hospitals |
| month | DateTime | |
| patient_name | String | |
| patient_mobile | String | default '' |
| doctor_name | String | default '' |
| claim_type | String | enum: cashless, reimbursement, grievance |
| insurance_company_id | String? | FK → insurance_companies, nullable |
| tpa_id | String? | FK → tpas, nullable |
| policy_no | String | default '' |
| client_id | String | default '' |
| ccn_no | String | default '' |
| date_of_admit | DateTime | |
| date_of_discharge | DateTime? | nullable |
| hospital_final_bill | Float | default 0 |
| mou_discount | Float | default 0 |
| deduction | Float | default 0 |
| final_approval_amount | Float | default 0 |
| final_approval_date | DateTime? | nullable |
| file_received_date | DateTime? | nullable |
| submit_mode | String | default '' |
| courier_submit_date | DateTime? | nullable |
| online_submit_date | DateTime? | nullable |
| courier_company_name | String | default '' |
| pod_number | String | default '' |
| settlement_amount | Float | default 0 |
| settlement_amount_deduction | Float | default 0 |
| mou_discount_on_settlement | Float | default 0 |
| tds | Float | default 0 |
| bank_transfer_amount | Float | default 0 |
| settlement_date | DateTime? | nullable |
| neft_no | String | default '' |
| file_price | Float | default 0 |
| remarks | String | default '' |
| rejected_reason | String | default '' |
| created_by_id | String? | FK → users, nullable |
| updated_by_id | String? | FK → users, nullable |
| created_at | DateTime | |
| updated_at | DateTime | |

### claim_documents
| Column | Type | Notes |
|--------|------|-------|
| id | String (uuid) | PK |
| claim_id | String | FK → claims |
| file_name | String | |
| original_name | String | |
| file_path | String | |
| file_type | String? | nullable |
| file_size | Int? | nullable |
| category | String | enum: admit, discharge, bill, settlement_proof, pod, other |
| uploaded_at | DateTime | default now() |

### document_submissions
| Column | Type | Notes |
|--------|------|-------|
| id | String (uuid) | PK |
| hospital_id | String | FK → hospitals |
| patient_name | String | |
| document_type_id | String | FK → claim_document_types |
| file_name | String | |
| original_name | String | |
| file_path | String | |
| file_type | String? | nullable |
| file_size | Int? | nullable |
| status | String | enum: pending, reviewed, claimed; default 'pending' |
| claim_id | String? | FK → claims, nullable |
| notes | String | default '' |
| uploaded_by_id | String? | FK → users, nullable |
| created_at | DateTime | |
| updated_at | DateTime | |

---

## 2. Application Layer Changes

### ORM
- Remove: `mongoose`
- Add: `prisma`, `@prisma/client`
- Schema file: `backend/prisma/schema.prisma`
- Client singleton: `backend/config/prisma.js` (replaces `backend/config/db.js`)

### Pre-save hooks → Controller logic
| Hook | New location |
|------|-------------|
| `User` password hashing | `authController` — hash before `prisma.user.create()` and on password update |
| `Claim` sr_no | `claimController` — `await prisma.claim.count() + 1` before create |
| `Claim` month_claim_no | `claimController` — count claims in that month before create |

### Model methods → Helper functions
| Method | New location |
|--------|-------------|
| `user.comparePassword()` | Inline `bcrypt.compare()` in `authController` |
| `user.toJSON()` (hide password) | Delete `password` from response objects in `authController` |
| `role.hasPermission(module, action)` | Helper function in `middleware/auth.js` |
| `role.getAllowedModules()` | Helper function in `middleware/auth.js` |

### Text search
PostgreSQL full-text search via `prisma.$queryRaw` on:
- `claims`: `patient_name`, `policy_no`, `ccn_no`
- `document_submissions`: `patient_name`

### Environment variables
| Remove | Add |
|--------|-----|
| `MONGO_URI` | `DATABASE_URL` (Neon connection string) |

---

## 3. Data Migration Script

**File:** `backend/migrate.js`
**Run:** `MONGO_URI=... DATABASE_URL=... node backend/migrate.js`

### Migration order
1. Roles → `roles` + `role_module_permissions`
2. Hospitals → `hospitals` + `hospital_billing_services` + `hospital_doctors`
3. Insurance companies → `insurance_companies`
4. TPAs → `tpas`
5. Claim statuses → `claim_statuses`
6. Claim document types → `claim_document_types`
7. Users → `users` (depends on roles, hospitals)
8. Claims → `claims` + `claim_documents` (depends on hospitals, insurance, tpa, users)
9. Document submissions → `document_submissions` (depends on hospitals, document types, claims, users)

### ID mapping strategy
- Build `Map<mongoId, postgresUuid>` for each entity
- Generate new `uuid` for each record in PostgreSQL
- Resolve all foreign keys using the maps before insert

### Safety guarantees
- Read-only on MongoDB — never writes back
- Idempotent — safe to re-run after wiping PostgreSQL
- Logs count per collection on completion

---

## 4. Deployment Cutover

1. Create Neon free-tier database → get `DATABASE_URL`
2. Run `npx prisma migrate deploy` on Neon — creates all 13 tables
3. Run `node backend/migrate.js` locally — pulls MongoDB, pushes to Neon
4. Update Render environment: replace `MONGO_URI` with `DATABASE_URL`
5. Deploy new backend to Render
6. Smoke test: login, claims, hospitals, roles in production
7. Keep MongoDB live for 1–2 weeks as backup, then delete

### Frontend
Zero changes required. All `/api/*` routes stay identical.

### Seed script
`backend/seed.js` rewritten for Prisma — same data, Prisma syntax. Run on Neon after migration for reference data.
