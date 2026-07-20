# YAML Form Specification 1.0

本規格定義可供靜態 QA 的表單契約。它採用安全的 YAML 1.2 Core 子集，欄位名稱使用 `snake_case`，所有行為規則皆為結構化資料。

## 1. 安全 YAML 子集

支援：

- 以空白縮排的 mapping 與 sequence
- 單行 plain、單引號與雙引號字串
- `null`、`true`、`false`、整數與有限小數
- flow sequence（例如 `[a, b]`）與 flow mapping（例如 `{value: a, label: A}`）
- `#` 行內註解與單一文件起始標記 `---`

不支援並直接拒絕：

- tab 縮排、重複 key、多文件、directive
- tag、anchor、alias、merge key
- block scalar `|`、`>` 與多行 quoted scalar
- NaN、Infinity、時間戳自動轉型

含 `:`、`#`、`[`、`]`、`{`、`}` 或前後空白的文字應加引號。

## 2. 根節點

```yaml
spec_version: "1.0"       # 必填，固定為 1.0
prj_id: prj_demo-001       # 必填，可由 CLI 明確覆寫
title: 報名表               # 建議
locale: zh-TW              # 選填
description: 測試用表單     # 選填
forms: []                   # 必填，至少一份
metadata: {}                # 選填，不參與驗證
```

未知 key 會產生錯誤；`x-` 開頭的 extension key 可保留，但不參與 QA。

## 3. 表單

```yaml
forms:
  - id: registration
    title: 報名資料
    description: 選填
    fields: []
    rules: []
    metadata: {}
```

`id` 與 `fields` 必填。同一份表單內的 field id 必須唯一；form id 在整份文件內必須唯一。

## 4. 欄位

```yaml
fields:
  - id: email
    label: 電子郵件
    type: email
    required: true
    read_only: false
    disabled: false
    sensitive: false
    default: null
    placeholder: name@example.com
    description: 選填
    options: []
    constraints: {}
    visible_when: null
    required_when: null
    metadata: {}
```

支援型別：

| 類別 | `type` |
|---|---|
| 文字 | `text`, `textarea`, `email`, `tel`, `url` |
| 數值 | `integer`, `number` |
| 日期時間 | `date`, `time`, `datetime` |
| 選項 | `select`, `radio`, `checkbox` |
| 布林 | `boolean` |

`required`、`read_only`、`disabled`、`sensitive` 必須是 Boolean。`read_only` 與 `disabled` 不得同時為 true。`default` 必須通過該欄位所有靜態規則。

## 5. Constraints

```yaml
constraints:
  min_length: 2
  max_length: 80
  pattern: "^[^@]+@[^@]+$"
  minimum: 0
  maximum: 120
  exclusive_minimum: false
  exclusive_maximum: false
  multiple_of: 1
  min_items: 1
  max_items: 3
```

適用性：

- `min_length`、`max_length`、`pattern`：文字型別
- `minimum`、`maximum`、`exclusive_minimum`、`exclusive_maximum`：數值、日期時間型別
- `multiple_of`：`integer`、`number`
- `min_items`、`max_items`：`checkbox`

下限不得大於上限；最小長度／數量不得大於最大長度／數量；數字限制必須是有限數值；pattern 必須是有效 JavaScript regular expression，且不要包含 `/.../` delimiters。

## 6. Options

`select`、`radio`、`checkbox` 必須有至少一個 option。其他型別不得宣告 options。

```yaml
options:
  - value: adult
    label: 成人
    disabled: false
  - value: child
    label: 兒童
    disabled: false
```

為方便移植，也接受 scalar shorthand（例如 `options: [adult, child]`），但正式規格建議使用物件格式。`value` 在同一欄位內必須唯一。

## 7. 條件式欄位

```yaml
required_when:
  field: contact_method
  operator: equals
  value: email
```

支援 operator：

- `equals`, `not_equals`
- `in`, `not_in`（value 必須是 sequence）
- `is_empty`, `not_empty`（忽略 value）
- `greater_than`, `greater_than_or_equal`, `less_than`, `less_than_or_equal`

`field` 必須指向同一份表單內的另一欄位，不得自我參照。`visible_when` 與 `required_when` 使用相同結構。

## 8. 跨欄位規則

### compare

```yaml
rules:
  - id: date_order
    type: compare
    left: start_date
    operator: less_than_or_equal
    right: end_date
    message: 結束日不得早於開始日
```

### at_least_one / all_or_none

```yaml
rules:
  - id: contact_required
    type: at_least_one
    fields: [email, phone]
    message: 至少填寫一種聯絡方式
  - id: address_complete
    type: all_or_none
    fields: [city, address]
    message: 城市與地址需同時填寫
```

`compare` 支援 `equals`、`not_equals`、`greater_than`、`greater_than_or_equal`、`less_than`、`less_than_or_equal`。規則只能引用同一份表單內的欄位。

## 9. 版本與相容性

- 讀取器必須拒絕未知的 major version。
- 新的 optional key 應使用 `x-` extension，直到規格正式納入。
- converter 必須輸出明確的 finding，不得靜默丟棄無法映射的來源規則。
