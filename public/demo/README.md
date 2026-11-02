# Demo datasets

Small, fully synthetic Spanish and French clinical sentence sets for trying
MedTranslate without a dataset of your own. They contain no real patient
data; every sentence was written for this demo.

| File | Source column | Rows |
|---|---|---|
| `medtranslate_demo_spanish.csv` | `spanish_source` | 15 |
| `medtranslate_demo_french.csv` | `french_source` | 15 |

Each file has the columns MedTranslate expects: `pair_id`, `source`,
`content_type`, the language source column, and `english_reference`.
Load one with the "Try a demo dataset" buttons on the Upload page, or
download it and upload it like any other file.
