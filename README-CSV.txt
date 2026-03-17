╔═══════════════════════════════════════════════════════════════════════════╗
║                    CSV MENU TEMPLATE - QUICK START                        ║
╚═══════════════════════════════════════════════════════════════════════════╝

📄 FILES INCLUDED:
  └─ menu-template.csv         → Ready-to-use template with 10 examples
  └─ CSV-TEMPLATE-GUIDE.md     → Complete documentation

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 CSV FORMAT:

name,category,price,description,size,tags
Margherita Pizza,Pizza,18.50,Fresh mozzarella with basil,Large (12"),vegetarian,classic
Caesar Salad,Salads,12.00,Crispy romaine with parmesan,Regular,vegetarian
Grilled Salmon,Main Course,26.00,Atlantic salmon with vegetables,8oz,healthy,gluten-free

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ REQUIRED COLUMNS:
  • name    → Item name (must not be empty)
  • price   → Number only (no currency symbols: 18.50 not $18.50)

📌 OPTIONAL COLUMNS:
  • category    → Groups items (Pizza, Appetizers, Main Course, etc.)
  • description → Details about the item
  • size        → Portion info (Large, 8oz, Regular, etc.)
  • tags        → Comma-separated tags (vegetarian,vegan,gluten-free)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

❌ COMMON MISTAKES:

WRONG:                          RIGHT:
$18.50                    →     18.50
USD 25.00                 →     25.00
["vegetarian","vegan"]    →     vegetarian,vegan
18,50                     →     18.50

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🏷️ POPULAR TAGS:

Dietary:     vegetarian, vegan, gluten-free, dairy-free, halal, kosher
Spice:       spicy, mild, medium, hot
Health:      healthy, low-calorie, organic, local
Special:     classic, signature, chef-special, new, popular
Beverages:   alcohol, coffee, tea

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚀 HOW TO USE:

1. Open menu-template.csv in Excel, Google Sheets, or any text editor
2. Replace example items with your menu
3. Save as CSV (UTF-8 encoding)
4. Go to Admin Panel → Upload File
5. Select your CSV file
6. Review and Save!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 TIPS:

✓ Start simple with just name and price
✓ Add categories to organize your menu
✓ Use descriptions to increase sales
✓ Tags help customers find what they need
✓ Size info reduces customer questions

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔧 TROUBLESHOOTING:

Problem: "SQLite can only bind numbers, strings..." error
Solution: - Remove currency symbols from price column
          - Ensure tags are comma-separated text, not JSON
          - Save file as UTF-8 CSV

Problem: Items not importing
Solution: - Check that "name" column exists
          - Verify name column has values
          - Check for special characters

Problem: All items show as "General" category
Solution: - Add a "category" column
          - Put category names in that column

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📞 NEED HELP?

• Read CSV-TEMPLATE-GUIDE.md for detailed instructions
• Check demo menu at /menu.html?id=demo for examples
• Contact: support@restorder.online

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
