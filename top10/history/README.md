# Past Top 10 editions, 2020–2025, and the 2020 all-time thread

This folder holds the five yearly Top 10 threads from the osu! forum (TOP10-DESIGN.md §13.10) and the one all-time
thread (§13.11), imported as data.

| File | Kind | Edition | Thread | Ballots |
|---|---|---|---|---|
| `2020.json` | year | 2020 | [topic 1219987](https://osu.ppy.sh/community/forums/topics/1219987) | 1 |
| `2021.json` | year | 2021 | [topic 1467848](https://osu.ppy.sh/community/forums/topics/1467848) | 6 |
| `2022.json` | year | 2022 | [topic 1692581](https://osu.ppy.sh/community/forums/topics/1692581) | 6 |
| `2024.json` | year | "2023–24" | [topic 2015344](https://osu.ppy.sh/community/forums/topics/2015344) | 4 |
| `2025.json` | year | 2025 | [topic 2172025](https://osu.ppy.sh/community/forums/topics/2172025) | 9 |
| `alltime-2020.json` | alltime | 2020 ("All time (2020)") | [topic 1115540](https://osu.ppy.sh/community/forums/topics/1115540) | 7 |

The shape of each file is:

```
{ kind?, edition, label, thread, ballots: [{ voter, post, picks: [{ id, spot }], mentions: [id], watch: [id], notes? }] }
```

- `kind` is `"year"` or `"alltime"`, and missing means `"year"` (§13.11). Only the all-time file sets it.
- All-time files are named `alltime-<year>.json`, and their `watch` lists are empty: the all-time ballot has no ones to watch.
- Every id is an osu! user id. `ALIASES.md` maps each name as written to its id, with the evidence.
- `post` is the forum post's own URL.
- Write-up text isn't copied.

`node top10/history/check.mjs [edition | alltime]` checks the files and prints each one's ranking by the §13.5 formula.
For 2025 it also checks the result against the expected numbers (see below).

## For the code that reads these

- **2020 has 1 ballot and 2023–24 has 4.** That's below the live minimum of 5 (§5), so `computeResults` in `top10/score.js` would refuse them. The history path has to skip that check.
- **One ballot has 11 picks:** tartaruga57's 2023–24 list (see below). Its spots pass `spotsValid`, but it's over the live `MAX_PICKS` of 10. The 11th pick gets 0 points.
- **anomi (24642612) isn't in `players.json`,** and the osu! profile is 404 today. The maintainer has confirmed anomi stays in the past results, so the name comes from `ALIASES.md`. anomi is 2nd in 2025 and 7th in 2023–24.
- **_wb (19423459) is GoncS,** renamed (confirmed by the maintainer). Show the current name, but the forum lists say GoncS.
- **`alltime-2020.json` is the first `kind: "alltime"` file.** `import-past.mjs` only reads files named `<year>…json`, so it skips this one until it learns the all-time kind. Its 7 ballots meet the live minimum of 5.

## What's left out

- **Joke, empty or comment-only posts:**
  - 2020: Nikolai's "yes".
  - 2021: Formed's ("cause Tris is the only Portugal's CTB player I know").
  - 2022:
    - biji's "1. DemiGOAT 2. everyone else";
    - Nelson's "I don't have the knowledge";
    - AlexFenom's two comments;
    - Nikolai's quote reply.
  - 2023-24:
    - TRUE_PLAYER36's "I don't know";
    - AlexFenom's comment;
    - ExPin's and Leo5h's quote-only replies;
    - ExPin's "List updated" reply.
  - All time (2020): Nikolai's "#1".
- **Skillset lists:** suzuhiro77's 2025 NM / HR / DT / HD / EZ / FL / converts podiums (decision 5).
- **Write-up text:** the post link stands in for it.

## How the lists were read

Picks are listed in the order written, and spots follow the §13.5 rule. A tie repeats the spot, and the next spot skips. Each ballot's `notes` says how its list was read.

- **Tris 2022:** "6. Nelson / 6. [SS]Bell" is a tie at 6, 4.5 points each.
- **_wb 2022:** "6.5. Nelson" is spot 7. It's the 7th name, below Yoxide, not tied with him.
- **DemiGod Yoxide 2022:** "9 && 10- Godo_Plays // held" is Godo 9 and held 10, the order he gives (by their 1v1).
- **Rosa 2023–24:** "10. tartaruga57 and Godo_Plays" is a tie at 10. It covers positions 10 and 11, so 0.5 points each.
- **tartaruga57 2023–24:** "8. AlexFenom / AfonsoMPt", "9. [Dementia]", "10. Godo_Plays" is 11 names numbered to 10.
  - Encoded as spots 8, 8, 10, 11. [Dementia] gets 1 point, and Godo_Plays 0 points (he still counts as on the list).
  - Read as written, they would get 2 and 1.
- **ExPin 2023–24:**
  - The opening post is unnumbered, so the order written is the ranking.
  - It was edited twice, last at 2024-12-15 22:56 UTC, six minutes before his "List updated" reply. The data uses the current version; the first one isn't recoverable.
- **Honourable mentions** are what a post calls "honourable mentions" / "HM" / "menções honrosas".
  - In Tris's 2022 section, that's Nicole, Tuga (Sp1ritGG, confirmed by the maintainer), and the new top-50 players he names.
  - It excludes Buffow, gold and ptrollyo, which he names only as left out for inactivity.
- **Ones to watch** are "Investments", "Investimentos" and "Players to look forward in the future".
  - ExPin's 2023–24 "All players below the top 10" names nobody, so it isn't counted.
  - suzuhiro77's 2023–24 "I'm investing in everyone from #6 down" is his own picks 6–10. A pick can't also be one to watch, so that's left out too.
  - His "Leo5h I see you..." is counted as one to watch.
- **Non-PT voters are kept** (confirmed by the maintainer), and marked in `notes`: Ritmo Brigido (Chile) and biji (Indonesia) in 2021, Patatita (Spain) in 2022, [ Ajia ] (Belgium) in 2025.
- **Edited posts** are used as they read now. osu! shows edits on:
  - Tris's 2021 and 2022 posts;
  - suzuhiro77's posts in every edition from 2021 on;
  - ExPin's 2023–24 and 2025 posts.

## The all-time thread (2020)

Tris's 2020 yearly post refers to "my all time top PT list". That list is the opening post of
[topic 1115540](https://osu.ppy.sh/community/forums/topics/1115540), "Portugal's Top 10 CTB Players of All Time", in the
osu!catch forum (30 Jul – 23 Aug 2020). Its rules: no voting for yourself, and not JungYeon ("a non-pt multi-acc").

- **7 lists, all from PT players,** each a plain 1–10 with no ties: Tris, DemiGod Yoxide, Sakuragi FanBoy, Airdown,
  suzuhiro77 (then Hiroto-), Rosa (then N1tro321) and SoulEater.
- **Sakuragi FanBoy's list is kept.** It was made "from memory" by someone active for about two months in 2018, but
  it's serious and from a PT player.
- **Honourable mentions:** only Tris names any: Hiroto (suzuhiro77) and RockMitic, as players he hopes will join the
  list one day. They're mentions, not ones to watch, which the all-time ballot doesn't have.
- **Tris's post was edited** 3 times, last on 16 Jan 2021. His 2020 yearly post, eight days earlier, gives gold801 #3 as
  the "same spot as my all time top PT list". Here gold801 is #4, below SoulEater, whose #3 has the longest write-up. As
  everywhere, the list is used as it reads now.
- **Its result:** Buffow 9.86, Tris 8.67, Airdown 8.17, gold801 7.57, PTrollYO 6.14, SoulEater 5.33, DemiGod Yoxide
  4.67, Rosa 2.67, [SS]Bell 2.29, Sp1ritGG 1.57; then Nicolexd13 1.43 and suzuhiro77 1.00. The backend's `pastResults`
  gives the same.
- **No other all-time thread was found.** osu!'s forum search needs a sign-in, so the search went through a web search
  and the osu!catch forum. The thread's 2020 date fits Tris's references to it.

## 2025 against §13.10

§13.10 expects GoncS 6.22, 5th. The data gives **GoncS 7.00, 4th** (above AfonsoMpt 6.78). **The expectation is wrong, not the data.**

- GoncS's lists total 56 points. 56 ÷ 9 = 6.22 treats GoncS as someone who didn't vote.
- But GoncS voted, as `_wb`:
  - osu! lists GoncS as the account's previous name;
  - ExPin links "GoncS" to it;
  - _wb's list leaves GoncS out.
- So by the §13.5 rule GoncS's own ballot comes out of the denominator: 56 ÷ 8 = 7.00.

Every other 2025 number matches §13.10 exactly. `check.mjs` checks both:
- the corrected ranking;
- §13.10's own numbers, with GoncS counted as a non-voter.
