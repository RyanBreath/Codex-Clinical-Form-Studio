# AirwayAI eCRF JSON 合約作者指南

> 此目錄目前只提供合成 Demo 合約，未經 Clinic 角色或 PI 核准，不可用於正式臨床資料蒐集。

## 合約結構

每份 eCRF 都是 JSON Schema Draft 2020-12，資料型別與限制放在標準的 `properties`、`required`、`enum`、`format`、`minimum` 等關鍵字；renderer 專用資訊集中在根層的 `x-airwayai`。

- `contractVersion`：renderer 語法版本。首版只接受 `1.0.0`。
- `formId`：穩定、不可重複的表單識別。
- `schemaVersion`：不可覆寫的 SemVer 表單快照。破壞欄位契約升 major，新增選填欄位升 minor，純文案修訂升 patch。
- `fields`：以 RFC 6901 JSON Pointer 索引 UI metadata。
- `layout`：只允許 `section`、`group`、`field` 與 1–3 欄配置；禁止 CSS、class 或 style。
- `computed`：首版只允許 `sum`，所有來源有效後才產生結果。

資料 object 必須設為 `additionalProperties: false`。發布後不得原地修改 JSON；請建立新版本與新 `$id`。

## 條件規則

`visibleWhen`、`enabledWhen`、`requiredWhen` 使用結構化 Predicate AST。可用運算子：

- 比較：`eq`、`neq`、`lt`、`lte`、`gt`、`gte`
- 集合：`in`、`contains`
- 存在：`exists`
- 組合：`all`、`any`、`not`

路徑不存在或型別不符合時，葉節點判定為 `false`；不可放入 JavaScript 或字串運算式。條件不可參照 computed 欄位，以維持單向、可稽核的相依圖。

```json
{
  "visibleWhen": {
    "all": [
      { "op": "eq", "path": "/sleepStudyCompleted", "value": true },
      { "op": "exists", "path": "/visitDate" }
    ]
  }
}
```

隱藏或條件停用的欄位會保留在當次瀏覽器 session，但不驗證、也不進入 `onChange` 或 `onSubmit` 的 active data。

## 元件與型別

| widget | JSON Schema 型別 |
| --- | --- |
| `text`、`textarea`、`date` | `string` |
| `integer` | `integer` |
| `number` | `number` |
| `radio`、`select` | 有 `enum` 的 primitive |
| `checkbox_group` | `array`，且 `items.enum` |
| `boolean` | `boolean` |
| `computed` | `number` 或 `integer`，並設 `readOnly: true` |
| `coordinate_3d` | 含 `x`、`y`、`z`、`unit` 的封閉 object |

`coordinate_3d` 的 `coordinate.axes` 或 `unitPath` 缺漏時，renderer 會回報 warning 並退回型別相容的基本數值輸入，不會把物件序列化成自由文字。

## 語系與內容安全

所有顯示文字都是 locale map，例如 `{ "zh-TW": "受試者代碼" }`。要求的 locale 缺少時退回 `defaultLocale`；預設語系本身缺字視為合約錯誤。

schema 不接受原始 HTML。外部連結必須使用 `links` 結構且限 HTTPS，renderer 永不使用 `dangerouslySetInnerHTML`。

## 驗證

在 `template/crf/` 執行：

```powershell
npm ci
npm run check
npm test
npm run build
```

正式 schema 還必須由 Clinic 角色依核准的 `program.yaml` 產生，並經 PI 與 QA 流程確認。
