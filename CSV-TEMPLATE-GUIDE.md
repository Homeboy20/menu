# CSV Menu Template Guide

## Quick Start

Use the `menu-template.csv` file as a starting point for creating your restaurant menu. Simply fill in your items following the format below.

## CSV Format

### Required Columns

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| **name** | Text | Item name (required) | "Margherita Pizza" |
| **price** | Number | Price without currency symbol | 18.50 |

### Optional Columns

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| **category** | Text | Menu section/category | "Pizza", "Appetizers", "Main Course" |
| **description** | Text | Item description | "Fresh mozzarella with basil..." |
| **size** | Text | Portion/serving size | "Large (12\")", "8oz", "Regular" |
| **tags** | Text | Comma-separated tags | "vegetarian,gluten-free" |

## Column Name Aliases

The system recognizes various column names:

- **Name**: name, item, item name, dish, product, menu item
- **Price**: price, cost, amount, rate, unit price
- **Category**: category, cat, section, type, course, group
- **Description**: description, desc, details, notes, ingredients
- **Size**: size, portion, serving, weight, volume
- **Tags**: tags, label, labels, tag

## Data Type Rules

### ✅ Correct Format

```csv
name,category,price,description,size,tags
Margherita Pizza,Pizza,18.50,Fresh mozzarella with basil,Large (12"),vegetarian,classic
Caesar Salad,Salads,12.00,Crispy romaine lettuce,Regular,vegetarian
```

### ❌ Common Mistakes

**1. Price with Currency Symbols**
```csv
❌ Wrong: $18.50, USD 18.50, €12.00
✅ Right: 18.50, 12.00
```

**2. Tags Format**
```csv
❌ Wrong: ["vegetarian","vegan"]
✅ Right: vegetarian,vegan
```

**3. Special Characters in Text**
- Use plain text for descriptions
- Avoid quotes unless necessary
- Use commas to separate tags only

## Example Menu Template

```csv
name,category,price,description,size,tags
Margherita Pizza,Pizza,18.50,Fresh mozzarella with basil and tomato sauce,Large (12"),vegetarian,classic
Caesar Salad,Salads,12.00,Crispy romaine with parmesan and croutons,Regular,vegetarian
Grilled Salmon,Main Course,26.00,Atlantic salmon with roasted vegetables,8oz,healthy,gluten-free
Chicken Wings,Appetizers,10.99,Spicy buffalo wings with blue cheese dressing,12 pieces,spicy
House Wine,Beverages,7.50,Italian red or white wine by the glass,5oz glass,alcohol
Tiramisu,Desserts,8.50,Traditional Italian dessert with mascarpone,Individual,classic,coffee
```

## Tag Suggestions

Use these common tags to help customers filter items:

### Dietary
- `vegetarian`
- `vegan`
- `gluten-free`
- `dairy-free`
- `nut-free`
- `halal`
- `kosher`

### Characteristics
- `spicy` (or `mild`, `medium`, `hot`)
- `healthy`
- `low-calorie`
- `organic`
- `local`
- `seasonal`

### Special
- `classic`
- `signature`
- `chef-special`
- `new`
- `popular`
- `alcohol`
- `coffee`

## Tips for Best Results

1. **Keep it Simple**: Start with just name and price if you're in a hurry
2. **Use Categories**: Group similar items together for better menu organization
3. **Be Descriptive**: Good descriptions increase sales
4. **Accurate Pricing**: Prices are stored as numbers - no currency symbols
5. **Consistent Sizing**: Use standard sizes (Regular, Large, 8oz, etc.)
6. **Relevant Tags**: Only add tags that help customers make decisions

## Importing Your CSV

1. Save your CSV file with UTF-8 encoding
2. Go to Admin Panel → Create Menu
3. Click "Upload File"
4. Select your CSV file
5. Review and adjust as needed
6. Click "Save Menu"

## Currency Detection

The system automatically detects your currency based on:
- Price format patterns
- Column headers containing currency codes (USD, EUR, GBP, etc.)
- Default: USD if no currency is detected

Supported currencies: USD, EUR, GBP, JPY, CNY, INR, CAD, AUD, CHF, SEK, NZD, ZAR, AED, SAR, KES, NGN, GHS, UGX

## Troubleshooting

**"SQLite can only bind numbers, strings..."** error?
- Check that prices contain only numbers and decimal points
- Remove currency symbols from price column
- Ensure tags are comma-separated text, not JSON arrays

**Items not importing?**
- Verify "name" column exists and has values
- Check for special characters or encoding issues
- Save file as UTF-8 CSV

**Categories showing as "General"?**
- Add a "category" column to organize items
- Category names are automatically title-cased

## Need Help?

- Check the demo menu for examples
- Review the menu-template.csv file
- Contact support at support@restorder.online
