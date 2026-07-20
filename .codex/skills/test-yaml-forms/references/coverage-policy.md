# YAML 表單 QA 覆蓋政策

## 優先順序

案例上限生效時，依下列順序保留：

1. 每份表單一個合法基準案例
2. 必填、型別、格式、選項成員與無效預設值
3. 長度、數值、日期與數量邊界
4. `required_when` 與 `visible_when`
5. 結構化跨欄位規則
6. 唯讀、停用與敏感欄位的人工檢查
7. 重複的低風險合法變體

將所有被裁減的候選案例與原因寫入報告，不得靜默刪除。

## 欄位處理

- `text`、`textarea`：合法語意值、必填空值、最小／最大長度、短一字、長一字、pattern mismatch、Unicode 與前後空白。
- `email`、`tel`、`url`：合法格式與明確無效格式；不要把可疑但可能合法的格式當成負向案例。
- `integer`、`number`：合法中點、精確上下限、界外值與 `multiple_of` 不符。
- `date`、`time`、`datetime`：合法 ISO 值、精確上下限與界外值。
- `select`、`radio`：每個未停用選項、必填空值與非成員值。
- `checkbox`：空集合、單一選項、多選、`min_items`、`max_items` 與非成員值。
- `boolean`：`true`、`false` 與必填缺值。
- `read_only`、`disabled`：靜態 QA 只檢查規格一致性，互動行為標記為 `需人工確認`。
- `sensitive`：仍測試規則，但只用明顯合成資料，輸出不得包含真實值。

## 條件式規則

- 先建立能觸發條件的 driver 值，再測試目標欄位。
- `required_when` 至少包含「條件成立且空值」負向案例。
- `visible_when` 至少包含成立與不成立狀態；顯示／隱藏本身屬 UI 行為，沒有 runtime 時標記人工確認。
- 找不到 driver 欄位、運算子與 value 不相容，或規則形成自我參照時，建立 finding，不猜測意圖。

## 跨欄位規則

- `compare`：測試一個合法順序與一個違反順序。
- `at_least_one`：測試全空與至少一欄有值。
- `all_or_none`：測試全空、全填與只填一欄。
- 不執行自由文字 expression。無法用結構化規則表達時，記錄為人工測試需求。

## 結果

預期結果為 `valid`、`invalid` 或 `manual`。實際狀態為 `PASS`、`FAIL` 或 `需人工確認`。規格 QA 的 PASS 僅表示測試資料符合 YAML 契約，不代表前端或後端實作通過。
