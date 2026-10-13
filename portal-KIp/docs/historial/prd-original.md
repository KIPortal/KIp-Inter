# Project Requirements Document (PRD): NOC Operations & Incident Dispatch System
**Platform:** NOC Portal Enterprise (Inter IP Operations)  
**Document Version:** 1.0.0  
**Status:** Approved / In Implementation  
**Design Reference:** macOS Native Human Interface Guidelines (SF Pro, Liquid Glass, Tahoe/Sonoma layout)  
**Target Viewport Baseline:** 1280 × 1024 px (NOC Video Wall & Monitor standard) + Fluid Responsiveness  

---

## 1. Executive Summary & Objective

The **NOC Portal** is an enterprise-grade Network Operations Center monitoring, dispatch, and incident management dashboard designed specifically for telecom network supervision (`Operaciones IP - Inter`).

### Core Problem
High-density NOC dashboards often suffer from excessive cognitive load, cluttered ticket tables, visual fatigue during 8-hour shifts, and slow manual assignment workflows. Operators need to quickly identify critical SLA breaches, assign incoming queue incidents to specialized engineers, and monitor shift capacity without visual friction.

### Project Goals
1. **Reduce Operator Cognitive Load:** Streamline data fields, remove unnecessary email clutter, and prioritize status, priority, and wait times.
2. **Mac-Native Precision UI:** Emulate high-end macOS window chrome, typography (`SF Pro`), translucent frosted-glass materials (`Liquid Glass`), and native interactive controls.
3. **Live Assignment & Immediate Feedback:** Provide modal-driven ticket dispatch with real-time UI status reflection and macOS Liquid Glass push toast notifications.
4. **Ergonomic Display Support:** Strictly tailored for fixed 1280×1024 monitoring displays while offering responsive flex wrapping and horizontal table scroll safety.

---

## 2. Key Personas & Roles

| Persona | Role | Primary Goals | Key Pain Points |
| :--- | :--- | :--- | :--- |
| **Shift Lead / Coordinador NOC** | Supervise queue, balance load, assign P1/P2 tickets to on-duty specialists | Needs instant count of unassigned criticals and available capacity. | Overcrowded tables, lack of feedback when a ticket is assigned. |
| **NOC Operator / Especialista** | Triage incoming network incidents (PON, BGP, FTTH, MPLS, OLT) | Focus on ticket resolution and target SLA countdowns. | Visual fatigue from high-saturation neon alert badges. |
| **System Auditor / Manager** | Shift turnover reporting, audit trails, SLA compliance analysis | Export shift metrics and verify compliance. | Inconsistent data views and lack of persistent shift records. |

---

## 3. Product Architecture & Information Hierarchy

```
┌────────────────────────────────────────────────────────────────────────┐
│ macOS Window Frame (Window controls [● ● ●], Title Bar, Search, Quick Act)│
├─────────────┬──────────────────────────────────────────────────────────┤
│ Persistent  │ Global Metrics Header (4 Liquid Glass Frosted Cards)     │
│ Sidebar     ├──────────────────────────────────────────────────────────┤
│ Navigation  │ Operational Action Bar (Filters, Mass Dispatch, Sync)    │
│             ├──────────────────────────────────────────────────────────┤
│ • Dashboard │ Incident Data Grid / Case Queue (1-click Modal Dispatch) │
│ • Auditoría ├──────────────────────────────────────────────────────────┤
│ • Gestión   │ Table Footer: Batch controls, Pagination, Status ping    │
│ • Reportes  │ Toast Layer: Floating Liquid Glass Notification (Top-R) │
└─────────────┴──────────────────────────────────────────────────────────┘
```

---

## 4. Feature Specifications

### 4.1. Global Metrics Header (Liquid Glass HUD)
Four persistent metric cards displaying real-time operational posture with Apple-inspired frosted glass styling:
* **Metric 1: Tickets Activos** (Active in current shift queue, e.g., `7 en cola`).
* **Metric 2: Tickets Realizados** (Closed today during the active shift, e.g., `0 cerrados` with shift trend indicators).
* **Metric 3: Críticos Sin Asignar** (P1 alerts requiring immediate technical operator intervention, e.g., `1 P1 Requiere OP`).
* **Metric 4: Operadores Disponibles** (Current active shift capacity ratio, e.g., `8 / 10 | 80% cap.`).

#### Visual & Technical Specs (Liquid Glass Cards):
* Dimensions: `240px–280px` auto-flex, height `77px`, border-radius `20px`.
* Dual-layer composite background:
  * Under layer: `linear-gradient(0deg, #1A1A1A, #1A1A1A), rgba(191, 191, 191, 0.25)` with `background-blend-mode: plus-lighter, lighten`.
  * Top glass layer: `background: #FFFFFF; background-blend-mode: multiply;` with inner insets `inset 0px 40px 5px -40px #282828`.
  * Blur & Depth: `backdrop-filter: blur(20px)` and soft multi-stop box shadows.
* Typography: SF Pro bold metric headers (`13px / -0.02em`) and subtitle descriptors (`11px`).

### 4.2. Incident Queue Table
Tabular data grid displaying active telecom cases with clean single-line density:
* **Checkbox:** Individual and mass-select capability.
* **Ticket ID:** Monospace / semibold identifier (e.g. `#INC-96761`).
* **Prioridad:** Low-saturation dot badge (`P1`, `P2`, `P3`).
* **Estado:** Technical muted badges with 10% opacity fills:
  * `Nuevo`: Neutral slate gray (`rgba(100, 116, 139, 0.10)`), dark slate text `#1e293b`.
  * `Reciente`: Ice blue tint (`rgba(2, 132, 199, 0.10)`), deep navy text `#0c4a6e`.
  * `En espera`: Soft warm amber (`rgba(217, 119, 6, 0.10)`), brown text `#451a03`.
  * `SLA Crítico`: Subdued rose wash (`rgba(225, 29, 72, 0.10)`), deep burgundy text `#881337`.
  * `En Progreso`: Translucent macOS blue with live pulse dot.
* **Asunto:** Clean network issue description (e.g., *Falla Masiva de Enlace*, *Intermitencia PON*, *Revisión BGP*).
* **OP / Asignado:** Unassigned state (`— Sin asignar`) vs. Assigned operator badge with avatar initials (e.g., `CM - Carlos Mendoza`).
* **Tiempo:** Wait time counter (`1 min esp.`) transitioning to attention time (`0 min aten.`).
* **Acción:** Dual state button:
  * Default: `Asignar` (Primary macOS Blue `#007AFF`).
  * Assigned: `Ver detalles` (Secondary neutral glass button).

### 4.3. Interactive Assignment Modal ("Config de Asignación")
* Triggered upon clicking `Asignar` or the Ticket identifier.
* Fields:
  * Ticket code (Read-only / highlight state with macOS focus ring).
  * Asunto / Problem summary.
  * Área dropdown (Redes FTTH, Core IP, Enlaces BGP, Acceso OLT).
  * Operador dropdown (Specialist selection: Carlos Mendoza, Andrea Silva, Manuel Torres, Desktop).
* Action buttons:
  * `Delete` (Soft red cancel/unassign).
  * `Cancel` (Close modal without changes).
  * `Save` (Commit assignment, trigger live row update and toast notification).

### 4.4. Dispatch Toast Notification ("Liquid Glass Banner")
* Triggered automatically upon successful assignment.
* Placement: Top right corner of window chrome (`z-index: 9999`).
* Geometry: `344px × 77px`, `border-radius: 20px`, Liquid Glass frosted backdrop.
* Left icon: Green circular checkmark badge (`#34C759`) with sharp SVG tick.
* Center content:
  * Title: **Nueva Asignación** (`SF Pro 13px bold`).
  * Description: **se asignó correctamente a [Nombre del Operador]** (`SF Pro 13px regular`).
* Right side:
  * Timestamp (`Ahora` / `11px`).
  * Operator avatar thumbnail with initials.

---

## 5. Non-Functional Requirements & Design Tokens

### 5.1. Performance & Latency
* **Screen Rendering:** 60fps animations for modal open/close and toast sliding.
* **Table Performance:** Zero DOM lag when re-rendering rows upon assignment.
* **Viewport Adaptability:** Tailored for 1280×1024 monitoring screens with `min-width: 950px` table guard and macOS overlay scrollbars.

### 5.2. Design Tokens
* **Primary Brand Blue:** `#007AFF` / `#0284c7`
* **Success Green:** `#34C759`
* **Alert Red:** `#FF3B30` / `#E11D48`
* **Background Surface:** `#F5F6F8` (macOS subtle canvas gray)
* **Card Surface:** `#FFFFFF` with 0.5px border outline `#E5E7EB`
* **Typography:** `SF Pro Display`, `SF Pro Text`, `-apple-system`, `BlinkMacSystemFont`, `IBM Plex Sans`.

---

## 6. Implementation Roadmap & Next Milestones

1. **Phase 1 (Completed):**
   * High-fidelity UI design and layout structure.
   * macOS native component adaptation.
   * Liquid Glass cards and assignment notification prototype.
   * Low-saturation technical badge color palette.
2. **Phase 2 (Immediate Next Steps):**
   * Live backend API integration for ticket queues (WebSocket / REST).
   * Shift turnover summary export (PDF/CSV).
   * Multi-ticket batch assignment automation.
   * Real-time NOC telemetry ping and OLT synchronization heartbeat.
