# Variables and Types

Variables are named containers for storing data values. Python uses dynamic typing, so you do not need to declare a variable's type.

## Assigning Variables

Use `=` to assign a value to a variable:

```python
name = "Alice"
age = 25
height = 1.68
is_student = True
```

## Data Types

Python has several built-in data types:

| Type    | Example            | Description        |
| ------- | ------------------ | ------------------ |
| `int`   | `42`               | Whole numbers      |
| `float` | `3.14`             | Decimal numbers    |
| `str`   | `"hello"`          | Text               |
| `bool`  | `True`             | True or False      |
| `list`  | `[1, 2, 3]`        | Ordered collection |
| `dict`  | `{"key": "value"}` | Key-value pairs    |

### Checking Types

Use `type()` to check a variable's type:

```python
x = 42
print(type(x))  # <class 'int'>
```

## Type Conversion

You can convert between types:

```python
# String to int
age_str = "25"
age_int = int(age_str)

# Int to float
score = 95
score_float = float(score)

# Number to string
count = 10
count_str = str(count)
```

## Naming Rules

Variable names must follow these rules:

- Start with a letter or underscore (`_`)
- Contain only letters, digits, and underscores
- Are case-sensitive (`age` and `Age` are different)

```python
# Valid names
user_name = "Bob"
_private = "hidden"
count2 = 10

# Invalid names
# 2count = 10      # starts with a digit
# user-name = "Bob"  # contains a hyphen
```

## F-Strings

F-strings let you embed variables inside strings:

```python
name = "Alice"
age = 25
print(f"My name is {name} and I am {age} years old.")
```

Output:

```text
My name is Alice and I am 25 years old.
```

## Next Steps

Now that you can store data, the next chapter covers control flow — making decisions with `if` statements and repeating actions with loops.
