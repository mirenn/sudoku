import { useEffect, useState } from "react";
import { socketio } from '../socket';

export function Ranking({pubUserId}) {
    const [rdata, setRdata] = useState([]);
    useEffect(() => {
        function onRankingEvent(rankingData) {
            console.log('nagai ranking', rankingData);
            rankingData.sort((a, b) => b.rate - a.rate);
            setRdata(rankingData);
        }
        socketio.on('ranking', onRankingEvent);

        return () => {
            socketio.off('ranking', onRankingEvent);
        };
    }, []);

    const list: JSX.Element[] = [];
    rdata.forEach(({ name, rate, id }, index) => {
        const rank = getRank(rate);
        const ranknum = index + 1;
        const dispname = (id === pubUserId) ? name + '（あなた）' : name;

        list.push(
            <tr key={id}>
                <th>{ranknum}</th>
                <td>{dispname}</td>
                <td>{rate}</td>
                <td>{rank}</td>
            </tr>
        );
    });

    return (
        <div className="row d-flex justify-content-center">
            <div className="col-md-6">
                <div className="form-group">
                    <table id="ranking" className="table table-bordered caption-top table-hover ">
                        <caption>ranking</caption>
                        <thead>
                            <tr>
                                <th scope="col">#</th>
                                <th scope="col">name</th>
                                <th scope="col">rate</th>
                                <th scope="col">rank</th>
                            </tr>
                            {list}
                        </thead>
                    </table>
                </div>
            </div>
        </div>);
    function getRank(rate: number) {
        if (rate < 1500) {
            return "Iron";
        }
        else if (rate >= 1500 && rate < 1600) {
            return "Bronze";
        } else if (rate >= 1600 && rate < 1700) {
            return "Silver";
        } else if (rate >= 1700 && rate < 1800) {
            return "Gold";
        } else if (rate >= 1800 && rate < 1900) {
            return "Platinum";
        }
        else if (rate >= 1900 && rate < 2000) {
            return "Diamond";
        }
        else if (rate >= 2000 && rate < 2100) {
            return "Master";
        }
        else if (rate >= 2100 && rate < 2200) {
            return "Grandmaster";
        } else {
            //本当は上位100名のみ
            return "Challenger";
        }
    }
}