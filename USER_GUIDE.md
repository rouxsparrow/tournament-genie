# Tournament Genie - User Guide

Welcome to **Tournament Genie**, your admin-first solution for managing badminton doubles tournaments with precision and control.

---

## 🚀 Getting Started

Tournament Genie is designed for ease of use during live events. 

*   **Public Access**: Viewers can see live standings, brackets, and court schedules.
*   **Admin Access**: Log in via `/login` using your admin credentials to manage players, teams, matches, and scheduling.

---

## 👥 Player & Team Management

### 1. Creating Players
Navigate to the **Players** page to add participants. Each player requires a **Name** and **Gender**. 

### 2. Forming Teams
Teams consist of exactly two players and must follow category gender rules:
*   **Men's Doubles (MD)**: Male + Male
*   **Women's Doubles (WD)**: Female + Female
*   **Mixed Doubles (XD)**: Male + Female

### 3. Bulk Import
Save time by importing players and teams via CSV or XLSX. Templates are available on their respective pages. 
> [!TIP]
> Use the provided templates to ensure field names match exactly (e.g., "Name", "Gender", "Category").

---

## 🏆 Group Stage

### Group Creation & Seeding
You can manually create groups or use the **Randomize with Seeds** feature. 
*   **Group Seeds**: Mark stronger teams as `isGroupSeed` to distribute them evenly across different groups, ensuring a balanced tournament start.

### Standings Calculation
Standings are updated in real-time based on:
1.  **Wins** (Primary)
2.  **Point Difference**
3.  **Points Scored**
4.  **Head-to-Head**
5.  **Random Draw** (Stored as a last resort)

---

## ⚔️ Series Split & Knockout

### The Series A/B Split
Once the Group Stage is **locked**, the software automatically splits teams:
*   **Series A**: Typically the top-ranking teams (the goal is an 8-team Quarterfinal).
*   **Series B**: Remaining teams progress here.

### Second Chance Logic
If enabled, losers of the Series A Quarterfinals "drop" into Series B Quarterfinals, giving them a second chance at a podium finish.

---

## 📅 Real-Time Scheduling

The **Schedule** page is the heart of live tournament operations.

*   **Stage Toggle**: Switch between Group Stage and Knockout scheduling.
*   **Live Courts**: View currently playing matches and upcoming assignments.
*   **Auto-Schedule**: When enabled, the system automatically assigns the next eligible match to any free, unlocked court.
*   **Eligibility & Rest**: The system prioritizes matches with the most "rested" players (those who haven't played in the last 5 completed matches) while ensuring no player is scheduled on two courts simultaneously.
*   **Admin Overrides**:
    *   **Force Next**: Bump a critical match to the top of the queue.
    *   **Block Match**: Temporarily suspend a match (e.g., for injury).
    *   **Lock Court**: Prevent matches from being assigned to a specific court.

---

## 👁️ Viewer Features

### Favorite Player
Viewers can select a "Favorite Player" on the homepage. This choice persists via cookies and will:
*   Highlight the player's name in the live schedule.
*   Auto-filter standings and brackets to relevant categories for that player.

---

## 🛠️ Operational Tips

*   **Locking Stages**: Always verify scores before locking the Group Stage, as this action is required to generate knockout brackets and cannot be easily reversed.
*   **Court Efficiency**: Keep **Auto-Schedule** ON to minimize idle court time. Use **Force Next** for finals or high-profile matches.
*   **Walkovers**: If a team fails to show, use the **Walkover** status in the score entry modal to resolve the match instantly.
