// 問題
const question = [
    [8, 7, 1, 0, 0, 0, 5, 6, 4],
    [0, 9, 5, 0, 1, 7, 2, 3, 8],
    [2, 0, 3, 4, 5, 8, 0, 7, 1],
    [0, 2, 0, 1, 0, 3, 7, 9, 5],
    [0, 1, 9, 2, 7, 0, 8, 4, 3],
    [7, 0, 4, 0, 8, 5, 0, 0, 2],
    [1, 5, 0, 0, 0, 4, 3, 8, 0],
    [0, 8, 7, 5, 0, 0, 0, 0, 6],
    [0, 0, 0, 0, 3, 2, 1, 0, 7],
  ];
  
  // 問題回答
  let questionCheck = [
    [8, 7, 1, 0, 0, 0, 5, 6, 4],
    [0, 9, 5, 0, 1, 7, 2, 3, 8],
    [2, 0, 3, 4, 5, 8, 0, 7, 1],
    [0, 2, 0, 1, 0, 3, 7, 9, 5],
    [0, 1, 9, 2, 7, 0, 8, 4, 3],
    [7, 0, 4, 0, 8, 5, 0, 0, 2],
    [1, 5, 0, 0, 0, 4, 3, 8, 0],
    [0, 8, 7, 5, 0, 0, 0, 0, 6],
    [0, 0, 0, 0, 3, 2, 1, 0, 7],
  ];
  
  // 正解
  const anser = [
    [8, 7, 1, 3, 2, 9, 5, 6, 4],
    [4, 9, 5, 6, 1, 7, 2, 3, 8],
    [2, 6, 3, 4, 5, 8, 9, 7, 1],
    [6, 2, 8, 1, 4, 3, 7, 9, 5],
    [5, 1, 9, 2, 7, 6, 8, 4, 3],
    [7, 3, 4, 9, 8, 5, 6, 1, 2],
    [1, 5, 2, 7, 6, 4, 3, 8, 9],
    [3, 8, 7, 5, 9, 1, 4, 2, 6],
    [9, 4, 6, 8, 3, 2, 1, 5, 7],
  ];
  
  // クリックされた要素を保持
  let place;
  
  let point_1;
  let point_2;
  
  init();
  
  setInterval(() => {
    cpu();
  }, 4000);
  
  // ゲーム画面生成
  function init() {
    const main = document.querySelector(".main");
    const select = document.querySelector(".select");
  
    // スコアの初期化
    point_1 = 0
    point_2 = 0
  
    document.getElementById("point_1").textContent = point_1;
    document.getElementById("point_2").textContent = point_2;
  
    for (let i = 0; i < 9; i++) {
      let tr = document.createElement("tr");
      for (let j = 0; j < 9; j++) {
        let td = document.createElement("td");
        td.onclick = mainClick;
        tr.appendChild(td);
        if (question[i][j] != 0) {
          td.textContent = question[i][j];
          td.classList.add("clickdisable");
        } else {
          td.textContent = null;
          td.classList.add("clickenable");
        }
      }
      main.appendChild(tr);
    }
  
    for (let i = 0; i < 9; i++) {
      let td = document.createElement("td");
      td.onclick = selectClick;
      td.value = i + 1;
      select.appendChild(td);
      td.textContent = i + 1;
    }
  }
  
  // 問題パネルのマスが押された時の処理
  function mainClick(e) {
    if (place != undefined) {
      place.classList.remove("mainClick");
    }
  
    place = e.target;
    place.classList.add("mainClick");
  }
  
  // 数字選択のマスが押された時の処理
  function selectClick(e) {
    if (document.getElementsByClassName("mainClick")[0] === undefined || document.getElementsByClassName("mainClick")[0].textContent != "") { return; }
    let datas = document.getElementById("main").querySelectorAll("tr");
    for (let i = 0; i < datas.length; i++) {
      for (let j = 0; j < datas[i].querySelectorAll("td").length; j++) {
        if (datas[i].querySelectorAll("td")[j].classList.contains("mainClick")) {
          // 正誤判定
          check(i, j, e.target.value);
        }
      }
    }
  }
  
  // 正解判定
  function check(i, j, value) {
  
    if (anser[i][j] == value) {
      // 正解の場合
      point_1 += value
      document.getElementById("point_1").textContent = point_1;
      questionCheck[i][j] = value;
      document.getElementById("main").querySelectorAll("tr")[i].querySelectorAll("td")[j].textContent = value;
    } else {
      // 不正解の場合
      point_1 -= value
      document.getElementById("point_1").textContent = point_1;
    }
  
    // 終了検知
    if (!questionCheck.flat().includes(0)) {
      document.getElementsByClassName("remove")[0].classList.remove("display-none");
    }
  
  }
  
  //消す処理
  function remove() {
    let datas = document.getElementById("main").querySelectorAll("tr");
    for (let i = 0; i < datas.length; i++) {
      for (let j = 0; j < datas[i].querySelectorAll("td").length; j++) {
        if (question[i][j] != 0) {
          datas[i].querySelectorAll("td")[j].textContent = question[i][j];
          datas[i].querySelectorAll("td")[j].classList.add("clickdisable");
        } else {
          datas[i].querySelectorAll("td")[j].textContent = null;
          datas[i].querySelectorAll("td")[j].classList.add("clickenable");
        }
      }
    }
    document.getElementsByClassName("remove")[0].classList.add("display-none");
    // スコアの初期化
    point_1 = 0
    point_2 = 0
  
    document.getElementById("point_1").textContent = point_1;
    document.getElementById("point_2").textContent = point_2;
  
    questionCheck = question;
  }
  
  // CPUの処理
  function cpu() {
    let datas = document.getElementById("main").querySelectorAll("tr");
    for (let i = 0; i < datas.length; i++) {
      for (let j = 0; j < datas[i].querySelectorAll("td").length; j++) {
        if (datas[i].querySelectorAll("td")[j].textContent == "") {
          // 正誤判定
          // check(i, j, anser[i][j]);
          questionCheck[i][j] = anser[i][j];
          document.getElementById("main").querySelectorAll("tr")[i].querySelectorAll("td")[j].textContent = anser[i][j];
          point_2 += anser[i][j];
          document.getElementById("point_2").textContent = point_2;
          // 終了検知
          if (!questionCheck.flat().includes(0)) {
            document.getElementsByClassName("remove")[0].classList.remove("display-none");
          }
          return;
        }
      }
    }
  }
  