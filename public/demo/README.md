# Demo datasets

Small, fully synthetic clinical sentence sets for trying MedTranslate without
a dataset of your own. They contain no real patient data; every sentence was
written for this demo.

| File | Direction | Columns | Rows |
|---|---|---|---|
| `medtranslate_demo_spanish.csv` | Spanish → English | `spanish_source`, `english_reference` | 15 |
| `medtranslate_demo_french.csv` | French → English | `french_source`, `english_reference` | 15 |
| `medtranslate_demo_english_to_spanish.csv` | English → Spanish | `english_source`, `spanish_reference` | 15 |

Each file has the columns MedTranslate expects: `pair_id`, `source`,
`content_type`, a `<language>_source` column with the text to translate, and
a `<language>_reference` column with the human translation to score against.
The two language names tell the app which way to translate. Load one with
the "Try a demo" buttons on the Upload page, or download it and upload it
like any other file.
