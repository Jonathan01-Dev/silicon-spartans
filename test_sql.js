import initSqlJs from 'sql.js';
import fs from 'fs';

const init = async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run("CREATE TABLE test (name, age)");
    db.run("INSERT INTO test VALUES (?,?)", ["Alice", 25]);
    console.log(db.exec("SELECT * FROM test"));
};

init();
