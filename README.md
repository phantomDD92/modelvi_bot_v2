# Admin Website for Automated Posting Bots

This web application serves as an admin interface for managing automated posting bots designed for F2F, Fancentro, and Fansly sites. 

It allows agencies to efficiently control their bots, manage models, accounts, content, and proxies.

## Features

- **Agency Management**: 
  - Manage agencies that want to automate posting.
  - Agencies can create models, manage accounts, and append proxies for their bots.

- **Model Management**:
  - Handle models who are users on F2F, FanCentro, and Fansly.
  - Each model has a dedicated account for each site and associated content for posting.

- **Account Management**:
  - Manage accounts specific to each platform.
  - Bots utilize these accounts to automate posting actions.

- **Proxy Management**:
  - Manage proxies used by automation bots.
  - Agencies can append proxies to their bots for improved anonymity and performance.

- **Content Management**:
  - Create and manage content, including titles, photos, and videos for posting.
  - Contents are created per model by the agency and posted by the bot.


## Technologies Used

- **Frontend**: React
- **Backend**: Express.js
- **Database**: MongoDB
- **Version Control**: GitHub

## Installation

To set up the project locally, follow these steps:

1. **Clone the repository**:
```bash
$ git clone https://github.com/darkddev/post-bot-web.git
$ cd post-bot-web
```

2. **Install dependencies**

* For the backend:
```bash
$ cd server
$ npm install
```

* For the frontend:
```bash
$cd frontend
$npm install
```
3. **Set up environment variables**: 
Create a .env file in the server directory and add your configuration variables. 

Example:
```bash
DB_CONNETION_STRING=mongodb://localhost:27017/postbots
PORT=5000
SECRET_KEY=SECRET_KEY
```

4. **Run the application**:

* Start the backend server:
```bash
$ cd server
$ npm start
```
* Start the frontend application:
```bash
$ cd client
$ npm start
```
