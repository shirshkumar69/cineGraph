/* CineGraph recommendation engine. No network calls or dependencies. */
const CineEngine = (() => {
  const genres = ['Sci-Fi','Drama','Thriller','Adventure','Comedy','Animation','Romance','Action','Mystery','Horror','Documentary','Family','Fantasy','Other'];
  // Graph: undirected adjacency-list hash map; BFS: queue + visited set.
  function bfs(state,start,maxDepth=2) {
    const adjacency=new Map(state.profiles.map(p=>[p.id,[]]));
    for(const [a,b] of state.edges){adjacency.get(a).push(b);adjacency.get(b).push(a);}
    const queue=[{id:start,depth:0,via:null}],seen=new Set([start]);
    for(let head=0;head<queue.length;head++){
      const node=queue[head];if(node.depth>=maxDepth)continue;
      for(const id of adjacency.get(node.id)||[]){if(seen.has(id))continue;seen.add(id);queue.push({id,depth:node.depth+1,via:node.id});}
    }
    return queue;
  }
  // Each row of G is a unit-length movie genre vector.
  function vector(movie){return genres.map(g=>movie.genres.includes(g)?1/Math.sqrt(movie.genres.length):0);}
  function recommend(state,mode='blend',depth=2){
    const user=state.profiles.find(p=>p.id===state.active);
    const movies=new Map(state.movies.map(m=>[m.id,m]));
    const people=new Map(state.profiles.map(p=>[p.id,p]));
    // p = selected genre vector + G^T * centred ratings.
    const preference=genres.map(g=>user.preferences.includes(g)?1:0);
    for(const [id,rating] of Object.entries(user.ratings)){const m=movies.get(id);if(m)vector(m).forEach((v,i)=>preference[i]+=v*(rating-3));}
    const norm=Math.hypot(...preference)||1;
    const reached=bfs(state,user.id,depth).slice(1).filter(p=>people.get(p.id).canUse!==false);
    const weight=reached.reduce((sum,p)=>sum+1/p.depth,0)||1;
    const results=state.movies.filter(m=>!Object.hasOwn(user.ratings,m.id)).map(movie=>{
      const genre=Math.min(1,Math.max(0,vector(movie).reduce((sum,v,i)=>sum+v*preference[i]/norm,0)));
      const fans=reached.filter(p=>(people.get(p.id).ratings[movie.id]||0)>=4).map(p=>({...p,name:people.get(p.id).name,rating:people.get(p.id).ratings[movie.id]}));
      const friend=fans.reduce((sum,p)=>sum+(p.rating-3)/2/p.depth,0)/weight;
      const hasTaste=preference.some(x=>x!==0),hasFriends=reached.length>0;
      const score=mode==='genre'?genre:mode==='friends'?friend:(hasTaste&&hasFriends?.65*genre+.35*friend:hasTaste?genre:friend);
      return {movie,genre,friend,score,fans};
    }).sort((a,b)=>b.score-a.score||a.movie.title.localeCompare(b.movie.title));
    return {results,preference,reached};
  }
  return {genres,bfs,vector,recommend};
})();
export default CineEngine;
